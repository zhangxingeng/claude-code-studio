//! The matcher: turn a query string into a tantivy `BooleanQuery` — an
//! exact-term clause boosted above a same-token `FuzzyTermQuery` clause,
//! unioned across query tokens — combined with the caller's filters, ranked
//! by BM25. Replaces the old regex-crate substring/whole-word/regex scan
//! (issue #5: fuzzy/intent search over precision-editing tooling).
//!
//! Also carries a small substring-based cold-path matcher for session files
//! not yet reflected in the tantivy index (see `state.rs`'s cold tier) — a
//! deliberately simpler fallback than building a throwaway tantivy index per
//! uncached file.

use std::ops::Bound;

use serde::{Deserialize, Serialize};
use tantivy::collector::{Count, TopDocs};
use tantivy::query::{BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, Query, RangeQuery, TermQuery};
use tantivy::schema::{document::Value, IndexRecordOption};
use tantivy::snippet::SnippetGenerator;
use tantivy::{Index, Searcher, TantivyDocument, Term};

use super::index::SearchSchema;

/// Boost applied to an exact-term clause over its sibling fuzzy clause, so an
/// exact/near-exact match ranks above a loosely-fuzzy one (tantivy's fuzzy hits
/// otherwise score on par with exact hits — the risk flagged in issue #5).
const EXACT_BOOST: f32 = 3.0;
/// Levenshtein distance tolerated by the fuzzy clause (typo tolerance).
const FUZZY_DISTANCE: u8 = 1;
const SNIPPET_MAX_CHARS: usize = 240;

/// Query-time filters. Empty `sources`/`projects` mean "no restriction".
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFilters {
    /// Low-level block sources: user, assistant, thinking, tool_use, tool_result.
    #[serde(default)]
    pub sources: Vec<String>,
    /// Inclusive epoch-ms lower bound on the block timestamp.
    pub from: Option<i64>,
    /// Inclusive epoch-ms upper bound.
    pub to: Option<i64>,
    /// Home-relative project labels to include.
    #[serde(default)]
    pub projects: Vec<String>,
    /// Restrict to `tool_use` blocks for this exact tool name (e.g. "Bash",
    /// "Edit"). Overrides `sources` for matching purposes: a hit must be a
    /// `tool_use` block for this tool regardless of what's in `sources`.
    #[serde(default)]
    pub tool_name: Option<String>,
    /// Restrict results to this one session file (the "current session only" filter).
    #[serde(default)]
    pub session_path: Option<String>,
}

/// Returned when a search finishes (or is cancelled / truncated by limit).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSummary {
    /// Number of hits emitted.
    pub hits: usize,
    /// Total number of matching blocks found (before the `limit` truncation).
    pub scanned: usize,
    /// True if a newer search superseded this one before it finished.
    pub cancelled: bool,
    /// True if the result set stopped early because it hit the optional `limit`.
    pub truncated: bool,
}

/// One search result: a matched block plus a windowed snippet, the match
/// offsets (in *chars*, so the JS side can slice with `Array.from`), and its
/// relevance score (BM25 + the exact/fuzzy boost — highest first).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub session_path: String,
    pub project: String,
    pub ts: Option<i64>,
    pub line_no: i64,
    pub block_no: i64,
    pub uuid: String,
    pub source: String,
    pub snippet: String,
    pub match_ranges: Vec<(u32, u32)>,
    pub score: f32,
}

/// Tokenize a query string with the index's default analyzer — the same
/// analyzer that indexed the `text` field, so query tokens line up with the
/// terms in the index.
pub(crate) fn tokenize(index: &Index, text: &str) -> Result<Vec<String>, String> {
    let mut analyzer = index
        .tokenizers()
        .get("default")
        .ok_or("default tokenizer not registered")?;
    let mut stream = analyzer.token_stream(text);
    let mut tokens = Vec::new();
    while stream.advance() {
        tokens.push(stream.token().text.clone());
    }
    Ok(tokens)
}

fn term_query(field: tantivy::schema::Field, value: &str) -> Box<dyn Query> {
    Box::new(TermQuery::new(
        Term::from_field_text(field, value),
        IndexRecordOption::Basic,
    ))
}

fn should_group(clauses: Vec<Box<dyn Query>>) -> Box<dyn Query> {
    Box::new(BooleanQuery::new(
        clauses.into_iter().map(|q| (Occur::Should, q)).collect(),
    ))
}

/// Build the full query: an exact-boosted/fuzzy union per query token, ANDed
/// with the caller's filters. `Ok(None)` for an empty/whitespace-only query —
/// callers treat that as "no results" without running a search.
pub fn build_query(
    index: &Index,
    schema: &SearchSchema,
    query_str: &str,
    filters: &SearchFilters,
) -> Result<Option<BooleanQuery>, String> {
    let tokens = tokenize(index, query_str)?;
    if tokens.is_empty() {
        return Ok(None);
    }

    let token_clauses: Vec<Box<dyn Query>> = tokens
        .iter()
        .map(|tok| {
            let term = Term::from_field_text(schema.text, tok);
            let exact: Box<dyn Query> = Box::new(BoostQuery::new(
                Box::new(TermQuery::new(term.clone(), IndexRecordOption::WithFreqsAndPositions)),
                EXACT_BOOST,
            ));
            let fuzzy: Box<dyn Query> =
                Box::new(FuzzyTermQuery::new(term, FUZZY_DISTANCE, true));
            should_group(vec![exact, fuzzy])
        })
        .collect();
    let text_query = should_group(token_clauses);

    let mut must: Vec<(Occur, Box<dyn Query>)> = vec![(Occur::Must, text_query)];

    if let Some(tool_name) = &filters.tool_name {
        must.push((Occur::Must, term_query(schema.tool_name, tool_name)));
    } else if !filters.sources.is_empty() {
        let group = should_group(
            filters
                .sources
                .iter()
                .map(|s| term_query(schema.source, s))
                .collect(),
        );
        must.push((Occur::Must, group));
    }

    if !filters.projects.is_empty() {
        let group = should_group(
            filters
                .projects
                .iter()
                .map(|p| term_query(schema.project, p))
                .collect(),
        );
        must.push((Occur::Must, group));
    }

    if filters.from.is_some() || filters.to.is_some() {
        let lower = filters
            .from
            .map(|v| Bound::Included(Term::from_field_i64(schema.ts, v)))
            .unwrap_or(Bound::Unbounded);
        let upper = filters
            .to
            .map(|v| Bound::Included(Term::from_field_i64(schema.ts, v)))
            .unwrap_or(Bound::Unbounded);
        must.push((Occur::Must, Box::new(RangeQuery::new(lower, upper))));
    }

    if let Some(session_path) = &filters.session_path {
        must.push((Occur::Must, term_query(schema.session_path, session_path)));
    }

    Ok(Some(BooleanQuery::new(must)))
}

fn get_str(doc: &TantivyDocument, field: tantivy::schema::Field) -> String {
    doc.get_first(field)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn get_i64(doc: &TantivyDocument, field: tantivy::schema::Field) -> i64 {
    doc.get_first(field).and_then(|v| v.as_i64()).unwrap_or(0)
}

/// Run the built query against the warm tantivy index: collect the top
/// `limit` hits by relevance plus the total match count, and build a
/// highlighted snippet for each. Hits come back already sorted by score desc
/// (tantivy's `TopDocs` collector sorts internally) — no separate buffering
/// step needed for relevance ordering.
pub fn search_warm(
    searcher: &Searcher,
    schema: &SearchSchema,
    query: &dyn Query,
    limit: usize,
) -> Result<(usize, Vec<SearchHit>), String> {
    let top = searcher
        .search(query, &TopDocs::with_limit(limit).order_by_score())
        .map_err(|e| e.to_string())?;
    let total = searcher.search(query, &Count).map_err(|e| e.to_string())?;

    let mut snippet_gen =
        SnippetGenerator::create(searcher, query, schema.text).map_err(|e| e.to_string())?;
    snippet_gen.set_max_num_chars(SNIPPET_MAX_CHARS);

    let mut hits = Vec::with_capacity(top.len());
    for (score, addr) in top {
        let doc: TantivyDocument = searcher.doc(addr).map_err(|e| e.to_string())?;
        let text = get_str(&doc, schema.text);
        let snippet = snippet_gen.snippet_from_doc(&doc);
        let fragment = snippet.fragment();
        let match_ranges: Vec<(u32, u32)> = snippet
            .highlighted()
            .iter()
            .map(|r| {
                let cs = fragment[..r.start].chars().count() as u32;
                let ce = fragment[..r.end].chars().count() as u32;
                (cs, ce)
            })
            .collect();
        // A fuzzy-only match may not literally contain the query term, so the
        // snippet generator can return an empty fragment — fall back to a
        // plain leading excerpt of the stored text so the hit still has
        // something to show.
        let snippet_text = if fragment.is_empty() {
            text.chars().take(SNIPPET_MAX_CHARS).collect()
        } else {
            fragment.to_string()
        };

        let ts_val = get_i64(&doc, schema.ts);
        hits.push(SearchHit {
            session_path: get_str(&doc, schema.session_path),
            project: get_str(&doc, schema.project),
            ts: if ts_val == 0 { None } else { Some(ts_val) },
            line_no: get_i64(&doc, schema.line_no),
            block_no: get_i64(&doc, schema.block_no),
            uuid: get_str(&doc, schema.uuid),
            source: get_str(&doc, schema.source),
            snippet: snippet_text,
            match_ranges,
            score,
        });
    }

    Ok((total, hits))
}

fn floor_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn ceil_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

const COLD_WINDOW_BEFORE: usize = 60;
const COLD_WINDOW_AFTER: usize = 180;

/// Cold-path match: every query token must appear as a case-insensitive
/// substring (a simpler, non-fuzzy stand-in used only for session files not
/// yet reflected in the tantivy index — see `state.rs`'s cold tier). Returns
/// a windowed snippet around the earliest token match, with char-offset
/// ranges for every token occurrence inside that window.
pub fn cold_match(text: &str, tokens: &[String]) -> Option<(String, Vec<(u32, u32)>)> {
    if tokens.is_empty() {
        return None;
    }
    let lower = text.to_lowercase();
    let mut first = usize::MAX;
    for tok in tokens {
        let pos = lower.find(tok.as_str())?;
        first = first.min(pos);
    }

    let win_start = floor_boundary(&lower, first.saturating_sub(COLD_WINDOW_BEFORE));
    let win_end = ceil_boundary(
        &lower,
        (first + COLD_WINDOW_AFTER).min(lower.len()),
    );

    let mut snippet = String::new();
    let lead = win_start > 0;
    if lead {
        snippet.push('…');
    }
    snippet.push_str(&text[win_start..win_end]);
    if win_end < text.len() {
        snippet.push('…');
    }

    let base_chars = if lead { 1u32 } else { 0 };
    let mut ranges = Vec::new();
    for tok in tokens {
        let mut search_from = win_start;
        while let Some(rel) = lower[search_from..win_end.max(search_from)].find(tok.as_str()) {
            let s = search_from + rel;
            let e = s + tok.len();
            if s < win_start || e > win_end {
                break;
            }
            let cs = base_chars + text[win_start..s].chars().count() as u32;
            let ce = base_chars + text[win_start..e].chars().count() as u32;
            ranges.push((cs, ce));
            search_from = e;
        }
    }
    ranges.sort_unstable();

    Some((snippet, ranges))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::index::{open_index, SearchSchema};
    use std::fs;

    fn tmp_index(tag: &str) -> (Index, SearchSchema) {
        let dir = std::env::temp_dir().join(format!("ccstudio_query_test_{tag}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let schema = SearchSchema::build();
        let index = open_index(&dir, &schema.schema).unwrap();
        (index, schema)
    }

    fn add_block(
        writer: &tantivy::IndexWriter,
        schema: &SearchSchema,
        session_path: &str,
        project: &str,
        source: &str,
        text: &str,
    ) {
        let mut doc = TantivyDocument::default();
        doc.add_text(schema.session_path, session_path);
        doc.add_text(schema.project, project);
        doc.add_i64(schema.line_no, 0);
        doc.add_i64(schema.block_no, 0);
        doc.add_text(schema.uuid, "u1");
        doc.add_text(schema.source, source);
        let tool_name = if source == "tool_use" {
            text.split('\n').next().unwrap_or("")
        } else {
            ""
        };
        doc.add_text(schema.tool_name, tool_name);
        doc.add_text(schema.text, text);
        writer.add_document(doc).unwrap();
    }

    #[test]
    fn fuzzy_query_finds_typo_and_ranks_exact_above_it() {
        let (index, schema) = tmp_index("fuzzy_rank");
        let mut writer = index.writer(15_000_000).unwrap();
        add_block(&writer, &schema, "/a.jsonl", "~/app", "user", "please fix the parser bug today");
        add_block(&writer, &schema, "/b.jsonl", "~/app", "assistant", "the parsr looked fine to me");
        writer.commit().unwrap();

        let reader = index.reader().unwrap();
        let searcher = reader.searcher();

        let query = build_query(&index, &schema, "parser", &SearchFilters::default())
            .unwrap()
            .expect("non-empty query");
        let (total, hits) = search_warm(&searcher, &schema, &query, 10).unwrap();

        assert_eq!(total, 2, "exact + typo variant both match");
        assert_eq!(hits.len(), 2);
        // Exact match ("parser") must outrank the fuzzy typo match ("parsr").
        assert!(hits[0].snippet.contains("parser"));
        assert!(hits[0].score > hits[1].score);
    }

    #[test]
    fn filters_narrow_by_source_and_project() {
        let (index, schema) = tmp_index("filters");
        let mut writer = index.writer(15_000_000).unwrap();
        add_block(&writer, &schema, "/a.jsonl", "~/app", "user", "investigate the bug report");
        add_block(&writer, &schema, "/a.jsonl", "~/app", "assistant", "found the bug cause");
        add_block(&writer, &schema, "/b.jsonl", "~/lib", "user", "bug in the lib too");
        writer.commit().unwrap();

        let reader = index.reader().unwrap();
        let searcher = reader.searcher();

        let filters = SearchFilters {
            sources: vec!["assistant".into()],
            ..Default::default()
        };
        let query = build_query(&index, &schema, "bug", &filters).unwrap().unwrap();
        let (total, hits) = search_warm(&searcher, &schema, &query, 10).unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].source, "assistant");

        let filters = SearchFilters {
            projects: vec!["~/lib".into()],
            ..Default::default()
        };
        let query = build_query(&index, &schema, "bug", &filters).unwrap().unwrap();
        let (total, hits) = search_warm(&searcher, &schema, &query, 10).unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].project, "~/lib");
    }

    #[test]
    fn empty_query_yields_no_query() {
        let (index, schema) = tmp_index("empty");
        assert!(build_query(&index, &schema, "   ", &SearchFilters::default())
            .unwrap()
            .is_none());
    }

    #[test]
    fn cold_match_requires_all_tokens_and_returns_snippet() {
        let tokens = vec!["fix".to_string(), "parser".to_string()];
        let (snippet, ranges) = cold_match("please fix the parser bug today", &tokens).unwrap();
        assert!(snippet.contains("fix"));
        assert!(snippet.contains("parser"));
        assert_eq!(ranges.len(), 2);
        assert!(cold_match("nothing relevant here", &tokens).is_none());
    }
}

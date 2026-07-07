//! Search: extracted text from every session JSONL is indexed into an
//! embedded tantivy full-text index (BM25 ranking + fuzzy/typo-tolerant
//! matching) for intent-level "search engine" style queries — issue #5's
//! replacement for the original VS Code-style substring/regex scan. A small
//! SQLite table (`session_files`) still tracks mtime/size fingerprints for
//! cheap invalidation.
//!
//! Modules:
//!   `db`      — the sqlite fingerprint DB + engine-version migration marker.
//!   `extract` — port of `parser.ts`'s block extraction to Rust.
//!   `index`   — the tantivy schema, index open/writer, and the indexer.
//!   `query`   — query building (exact+fuzzy, boosted) and result assembly.

mod db;
mod extract;
mod index;
mod query;

// Re-exports so the rest of the crate can use these without reaching into
// submodules. `#[allow(unused)]` until wired up.
#[allow(unused_imports)]
pub use db::open_db;
#[allow(unused_imports)]
pub use extract::{extract_blocks, ExtractedBlock};
#[allow(unused_imports)]
pub use index::{
    build_index_parallel, index_file, remove_from_index, session_files, sweep_index, IndexStats,
    SearchSchema, SweepStats,
};
#[allow(unused_imports)]
pub use query::{build_query, search_warm, SearchFilters, SearchHit, SearchSummary};

// Public so lib.rs can register `state::search` / `state::refresh_index` /
// `state::index_status` as Tauri commands by their real paths.
pub mod state;

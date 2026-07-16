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

// Every submodule item is reached via its own path (`db::`, `index::`, …) from
// within the crate, so there are no crate-level re-exports here — an earlier
// `pub use` block re-exported the whole surface "for convenience" but nothing
// ever consumed it, so it was pure dead surface behind `#[allow(unused)]`.

// Public so lib.rs can register `state::search` / `state::refresh_index` /
// `state::index_status` as Tauri commands by their real paths.
pub mod state;

# G021 golden fixture

Semantic under test: **schema-compatible multi-month source combination**.

- `reference-tabwin415/result.xls`: unedited TabWin 4.15 BIFF export (the oracle)
- `reference-tabwin415/recipe.txt`: reconstructed capture settings
- `reference-tabwin415/capture-notes.md`: evidence and current status
- `expected/golden-table.json`: normalized rows, columns and cells
- `manifest.json`: hashes and comparison status

Raw DBC, DEF, CNV and DBF lookup inputs remain outside Git. This fixture is immutable evidence; implementation changes must conform to it or explicitly retain an unsupported status.

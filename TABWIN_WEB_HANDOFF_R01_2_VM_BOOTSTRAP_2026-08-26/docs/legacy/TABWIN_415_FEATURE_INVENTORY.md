# TabWin 4.15 — feature inventory from supplied distribution

This is a working archaeology list derived from the supplied 4.1.5 package documentation/history. It is not a complete formal specification.

## High priority for compatibility

- DBC/DBF input
- DEF-driven variable definitions
- CNV conversion/grouping
- line / column / selection / increment
- zero suppression
- saved `.TAB` and recovery of tabulation selections
- logs
- output table operations/totals
- DBF/subset output
- map association

## Important but later

- descriptive statistics
- derived columns / formulas
- normalization/min/max/absolute
- R analysis schemes
- SQL saved queries
- map point layers
- origin/destination flow tables and arrows
- distance calculations
- custom map imports

## Obsolete implementation mechanisms — do not reproduce literally

- BDE
- WinHelp
- Registry-driven R discovery
- WMF-first graphics
- FTP browser protocol assumptions

## Observed map formats/workflows

Historical documentation mentions/imports or exports involving:

- TabWin `.MAP`
- SHP
- E00
- BNA
- BND
- MIF/MID
- XY
- WPT
- GPX
- MME
- KML export

Support should be demand-driven. Built-in modern geography should use independently licensed modern sources.

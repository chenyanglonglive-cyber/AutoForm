# Design QA

Source visual: `C:\Users\leave\AppData\Local\Temp\codex-clipboard-349e4c53-752b-42ea-872e-bdb1bd7de71c.png`

Prototype checked: `http://127.0.0.1:3000/`, Report module `PA 12: Protection of the Environment`.

Checks:
- PA module header uses the same blue band treatment as the reference.
- PA12 renders five business questions from the real schema group, with the screenshot-confirmed question text for 12.1 through 12.5.
- Each PA question renders `Yes`, `Partially`, `No`, and `N/A` as one radio answer group.
- Each PA question renders `Evidence` with `MI`, `WI`, `WRI`, `SO`, and `DE` as right-side checkboxes.
- Each PA question includes a `Finding / Advance` expandable area for English and local-language finding fields.
- PA1, PA7, and PA13 were spot-checked and use the same grouping rules against their real schema field keys.

Remaining note:
- Full exact question titles for PA1-PA11 and PA13 are not present in the existing scraped schema; the UI falls back to the real PA/question number and module title until those labels are captured.

Final result: passed

# Quality Gates (before expanding preservation claims)

- Structure: output HTML/DOCX/XLSX has expected elements (table, header, image)
- Appearance: rendered output compared to fixture expected visual; colors/geoms match
- Coverage: text extracted >= 95% of fixture expected text; page count matches
- Fonts: custom embedded font renders correctly in browser
- Browsers: chrome/ff/safari render consistently
- OCR: scanned fixture text reconstructed with >= 90% accuracy
  Mark unavailable/best-effort if any gate fails. Text-only paths never claim CSS/layout.

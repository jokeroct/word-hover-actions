# Testing

What has been tested so far, and what hasn't.

## Release 1.0.5

**Formatting a selection over several lines**, line by line (it used to be refused). Checked in Obsidian 1.14.4 (Windows) with the dev-vault harness, on `Multiline sample.md`:
- Selecting three lines separated by blank lines ("A. Monosaccharides…", "B. …", "C. …"): the wheel shows "3 lines", with Bold, Italic, Highlight, and Extract available and Link and Define dimmed ("Selection spans several lines").
- Bold gave `**A. Monosaccharides (One Sugar)**`, `**B. …**`, `**C. …**`, and the selection kept all three. On it, Bold showed as applied, and clicking it again restored the original text exactly.
- Highlight on two list items went after the bullets: `- ==list item one==`.
- The wheel and toast and rendered-callout checks still pass.

**Ko-fi support link**, in the README, the manifest (`fundingUrl`), and a new Support group at the bottom of Settings. The Settings button shows a coffee icon beside "Support me on Ko-fi" and opens `https://ko-fi.com/mdsama`; it loads nothing from Ko-fi until clicked.

## Release 1.0.4

**The wheel opens faster**, with an **Open delay** setting (default 40 ms, range 0–500 ms), and a shorter opening animation. Timed in Obsidian 1.14.4 (Windows) with the dev-vault harness:
- Holding Shift and moving onto a word: the wheel was in the page after 46–55 ms (about 120 ms before).
- Pressing Shift while already resting on a word: 127 ms. That path keeps a 120 ms minimum, so typing a capital letter doesn't flash the wheel.
- Open delay 300 ms: 311 ms. Open delay 0: 8 ms. The setting appears in the Wheel group as a slider showing "40 ms".
- The wheel and toast check still passes.

## Release 1.0.3

**Rendered callouts in Live Preview** (e.g. PDF++ highlight callouts) now open the wheel. Checked in Obsidian 1.14.4 (Windows) with the dev-vault harness, on `Callout sample.md` (a PDF++ callout with nested quotes, highlights, bold, and links, and an untitled callout):
- A plain word ("Earth"): the wheel opens beside it, the word is tinted, and Highlight wrote `==Earth==` into the markdown.
- An already highlighted word: Highlight shows as applied, and Bold produced `==**microorganisms**==`.
- Bold text shows Bold as applied. A link in the text, the callout's title link, and a repeated title link further down all open the link tools for their own link.
- The callout icon and an untitled callout's default title ("Note") don't open the wheel; that callout's text does.
- The tint and the preset classes are removed when the wheel closes, and editor hovering outside callouts still works (wheel and toast check re-run).

**Shorten**, a new wheel action. Checked the same way, with Shorten placed in a slot, over the 3-sentence PDF++ paragraph:
- From a word inside the rendered callout, the dialog opens with the paragraph shortened to about half (73 → 44 words, two whole sentences with their highlights), and "About a third" shortened it further (24 words).
- **Insert below** added the short version as a new paragraph inside the same nested quote (`> >`), keeping the original. **Replace**, after editing the text by hand, replaced the paragraph with the edited text.
- A short line ("Intro line before the callout.") dims Shorten, with "Too short to shorten" in the center.
- **Local AI:** against a stand-in server answering like Ollama's `/api/generate`, the request carried the model, the prompt, and the paragraph, and the reply's reasoning text and chatty preface were stripped. A model Ollama doesn't have, and an address where nothing listens, both fall back to the built-in version with a clear message.
- Not yet tried: the local AI with a real model (the only one installed here was a 27B model, too large to load just for this), languages other than English, and very long selections.

## Release 1.0.2

Demo page only; the plugin's code is the same as in 1.0.1. The demo's stand-ins for Obsidian's DOM helpers moved to plain JavaScript (`demo/obsidian-dom.js`), which clears the last six review warnings. The demo renders the same markup as before (gallery, note, wheel, toast, and dialogs), and the review's lint rules report nothing for it.

## Release 1.0.1

Clears the code warnings from the Community directory review. Checked in Obsidian 1.14.4 (Windows) with the dev-vault harness:
- **Settings tab, now declarative:** every section renders, and Obsidian's settings search finds its rows (e.g. "color preset"). Choosing a preset, switching to 8 segments, and changing a slot all update the preview and keep the scroll position. Adding, renaming, and deleting a custom wrapper works. The toggle and dropdowns save to `data.json`. An invalid language code is still ignored.
- **Popout windows:** Settings opens in its own window in 1.14, so the preview wheel there is built in a second window's document, and it renders correctly.
- **Wheel and toast**, now built with Obsidian's `createEl` helpers: same segments, icons, labels, and hover text as before. The toast's buttons work (link all mentions) and it closes.
- **Demo page:** same markup as 1.0.0 for the gallery, note, wheel, toast, and dialogs. `?noanim` still stops all motion.
- Linted with `eslint-plugin-obsidianmd` 0.4.2 (the review's rules): no warnings in `src/`. The demo's stand-in for Obsidian's DOM helpers (`demo/obsidian-shim.ts`) still calls the native DOM methods it replaces.

## Release 1.0.0

- Installed into a real everyday vault (with 11 other community plugins and a community theme); the wheel works there.
- The interactive demo page (`docs/`) works in Chromium at desktop and phone widths, in dark and light themes, with no console errors.
- The code was checked against Obsidian's plugin guidelines: it uses the Vault API, `normalizePath()` for new note paths, and stylesheet classes instead of hard-coded styles, except for positions calculated at runtime.

## Automated (161 unit tests, all passing)

Run them with `npm test`.

- **Link parsing:** wikilinks with aliases, headings, and folders; the table-escaped `\|`; embeds; internal and external markdown links; links inside code ignored.
- **Mentions:** case-insensitive whole words; glued words skipped (`TBS`, `TB-related`, `TB_data`, `TB's`); multi-word terms across spaces; code, links, tags, frontmatter, code and math blocks skipped; regex characters; Devanagari.
- **Custom wrappers and strikethrough:** wrap, unwrap around or inside the selection, asymmetric wrappers (`<u>`…`</u>`), line edges, empty wrapper refused.
- **New target plans:** link tools for words inside a link (not for partial selections), Extract for multiline selections only (not words or frontmatter), Define allowed in code and links but not across lines.
- **Aliases and titles:** when to offer an alias; titles from passages (headings, lists, quotes, tasks, link syntax).
- **Look-ups:** Wikipedia summaries (standard, disambiguation, errors), Wiktionary definitions (language filter, HTML stripped, caps), note templates.
- **Settings:** defaults, no shared arrays, repairing invalid saved values (including names like `toString` or `constructor`), color presets, slot resolution (padding, deleted wrappers, unknown actions).
- **Word detection:** joiners, punctuation, markdown markers, accented letters, Devanagari, digits, astral characters.
- **Selection priority:** hovering inside versus outside a selection, empty selections, trimming; selections over several lines format but don't link or look up, and are blocked when they reach into a code block.
- **Formatting over several lines:** each line on its own, blank lines skipped; removed when every line has it, added to the rest when only some do; after list, task, heading, quote, and callout markers; partial first and last lines; table rows and rules left alone; refused when a line starts halfway into bold; custom wrappers; a round trip that toggles straight back.
- **Rendered callouts:** every rendered piece of a PDF++ callout is found in its markdown, including highlighted and linked text and repeated title links; escaped text and whitespace are skipped; the quote block around a position; the callout marker's end.
- **Shorten:** sentence splitting (abbreviations, initials, links, code, and math don't split); about half / a third as whole sentences in their original order, with formatting and links kept; wordy phrasing, opening linking words, and long asides trimmed, but not inside links or code, nor references in parentheses; the paragraph around a word, across soft line breaks and inside nested quotes; list items; headings, code, and short lines refused; selections over quote lines; Shorten settings repaired when invalid.
- **Blocking:** inline code, fenced code (backticks, tildes, longer fences, in quotes and lists), `$$` math, frontmatter, wikilinks, embeds, markdown, reference, and auto links, bare URLs, tags versus headings and `#2024`.
- **Bold/highlight toggles:** wrap, unwrap (exact, markers selected, inside a span), bold-italic, `__bold__`, partial-overlap refusal, merging contained spans, markers in code or links ignored, round trips, highlight independent of bold.
- **Italic toggles:** `*x*` and `_x_`; underscores inside words ignored; bold markers not mistaken for italics; bold-italic split both ways; italic around bold and bold around italic; list bullets and `2 * 3` ignored; round trips.
- **Note matching:** ranking order, aliases, case and space normalisation, path fallback, empty query, limit, ambiguous names.
- **Titles and duplicates:** title suggestion and validation; create planning, including case-insensitive path conflicts, same name in other folders, and non-note files; alias decision; table pipe escaping.

## Manually tested in Obsidian 1.14.4 (Windows)

In a separate test vault (not part of this repository), unless noted.

Frosted glass theme (version 0.3):
- **Wheel in dark mode:** glass segments, hover gradient with lift and glow, accent ring around the center. Checked with Theme accent, Aurora, Champagne, and Sunset.
- **Wheel in light mode:** Aurora. A first pass made the segments disappear against white; the rim is now tinted grey so the segment gaps show.
- **Settings:** preset swatches, and the live preview updating when the preset or the segment count changes.
- **Dialogs and picker:**
  - Peek dialog in light mode.
  - Note picker in dark mode. A regression that moved the picker to mid-screen was fixed; it sits near the top again.
- **Toast:** glass, gradient bar, and gradient button.

New features (version 0.2), using `Research sample.md`:
- **6-segment wheel:** all six actions in place; Extract dimmed for a single word.
- **Link + follow-ups:** linking `TB` to Tuberculosis brought up the toast.
  - **Add “TB” as alias** wrote `aliases: [TB]` into `Tuberculosis.md`.
  - **Link 1 more mention** linked the rest.
  - Both buttons worked in the same toast and changed to "✓ …".
- **Link tools:**
  - Peek showed the note and "linked from 1 note".
  - Unlink left plain `TB`.
  - Change produced `[[Graph view tips|Graph view]]`.
  - Split opened the note in a split pane.
  - The link wheel opens beside the whole link.
- **Extract:** a two-line selection showed only Extract enabled. It created `Inbox/Isoniazid resistance trend.md` with `source: "[[Research sample]]"` and replaced the passage with a link.
- **Define:** "infectious" showed Wikipedia's *Infection* summary and Wiktionary definitions. **Create linked note** made `Inbox/Infection.md` (URL in `source`) and wrote `[[Infection|infectious]]`.
- **Settings:** the tab renders every section. Switching to 8 segments shows Strike and Comment and is saved to `data.json`. Comment wrapped `%%killer%%` and toggled it off again.

With the radial wheel (0.1):
- Wheel opens beside the word when Shift is pressed while resting on it, centered on the line, with the word in the center.
- Bold segment drawn in the stronger tint on bold text.
- Pointer moves from the word into the Italic and Link segments without the wheel closing.
  - The hovered segment fills with the accent color.
  - The center switches to "Italic" / "Link/create note".
- Italic on bold "Graph" produced `***Graph***`.
- Over inline code: all segments dimmed, center reads "Inside inline code".
- Link segment → picker matched "Graph view" through its alias → `[[Graph view|graph]]`.
- A dev-only test harness re-ran its two simulations (below) with the wheel: both pass.

With the earlier bar menu. These parts of the code didn't change; only the menu's look and placement did:
- Pointer moves from the word into the menu without it closing; clicking Bold applied `**Graph**`.
- Escape closes the menu.
- Removing highlight from a word inside `==highlighted words==` removed the whole span in one edit.
- Disabled menu with the right reason over inline code, an existing link, a tag, a code block, and a multiline selection.
- Words in a task item and a blockquote work.
- Selection priority: selecting "banana bread" and hovering "bread" targeted the phrase; linking it to the existing note produced `[[banana bread]]`.
- Create flow: the title was edited to "Mango smoothie", the note was created in `Inbox/` (new-note setting respected), `[[Mango smoothie|Mango]]` was inserted, and the editor stayed on the original note.
- Ambiguous names: both `Apple` notes showed their paths, and the Create row warned about them.
- Duplicate refused: typing an existing Inbox note's name (different case) offered no Create row, and Shift+↵ showed "already exists" without creating anything.
- Invalid title `a:b` showed a reason and kept the picker open.
- Closes on pointer leave, on typing, and on scroll.
- Source mode: linking a word in a table row produced `[[Apple\|kiwi]]`, and the table still renders.
- Graph view shows the new links as edges.
- Via the dev harness (synthetic events through the same handlers):
  - Shift held *before* moving onto a word: no menu over the margin, and the menu opened on the word.
  - Editing the note while the picker is open: no link inserted and no note created, for both the create and the existing-note paths.

## Not yet tested
- **Theme (0.3), not yet checked:**
  - Graphite in either mode.
  - Sunset and Champagne in light mode.
  - The Extract and Define dialogs with the new look.
  - Community themes that restyle modals heavily.
  - Systems with reduced motion turned on.
- **New in 0.2, not yet tried in Obsidian:**
  - Strike and Math buttons. They use the same code paths as the tested toggles.
  - Extract with *Replace with: An embed*.
  - *Learn aliases: Always*.
  - Link tools on external markdown links and on embeds.
  - Define with no results or offline.
  - Clicking links inside the Peek preview.
  - Changing a slot's action and adding or deleting a custom wrapper in Settings.
- **Physically holding Shift before moving onto a word.** My automation could not hold Shift during mouse motion, so this order was only exercised with synthetic events.
- **Wheel-specific behavior:**
  - Escape, scroll, typing, and pointer-leave closing, re-checked with the wheel. The logic is unchanged, but the wheel covers a larger area.
  - Selection targets.
  - The wheel opening on the left when a word is near the right edge of a narrow pane.
- **One unexplained miss:** once, pressing Shift over a word did not open the menu, and the identical sequence worked on every later try. Watch for it in daily use.
- **Live Preview rendered blocks:** tables (edit them in Source mode or with the cursor inside), embeds, and math widgets don't open the menu. This is by design, to avoid acting on the wrong text, but check it suits you. Rendered callouts do open it.
- **Rendered callouts, not yet tried:** nested callouts, callouts with embeds or math inside, and folded callouts.
- Not tried:
  - Popout windows and split panes side by side.
  - Vim mode.
  - IME composition (e.g. Japanese or Chinese input).
  - Non-default themes.
  - The "Use [[Wikilinks]]" setting turned off (markdown links).
  - "Same folder as current file" as the new-note location.
  - Large vaults.
  - Editors embedded in Canvas.
- Text with no spaces (Chinese, Japanese) is treated as one long "word". Select the phrase instead.
- Reading view isn't supported (editor only), as intended.

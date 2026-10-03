# ECAAC Members Portal

Static site (index.html + app.js + app.css), hand-uploaded / served from `main`
at portal.ecaac.co.za. No build step; Supabase is the backend.

## Changelog — required for every member-facing change

Every new feature or visible change must get an entry in the **What's New**
page: the `CHANGELOG` array in `app.js` (search for `var CHANGELOG`).

- Add the entry at the **top** of the array, dated today (`yyyy-mm-dd`).
- `tag`: `'new'` for features, `'improved'` for changes to existing ones,
  `'fixed'` for bug fixes members would notice.
- Write `items` for members, not developers: what they can now do and where
  to find it. No file names, CSS or code terms.
- Same-day changes can share one entry. Purely internal work (refactors,
  code cleanup, invisible fixes) doesn't need an entry.
- A new entry lights the "What's New" marker in the sidebar for every member
  until they open the page, so don't add trivial entries.

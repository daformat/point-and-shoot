# @daformat/point-and-shoot

## 1.0.1

### Patch Changes

- The dot under the pointer is back to Glea's size: 14px with 6px corners by default (`dotSize`, and the new `dotRadius`), where 1.0.0 drew it at 4px.
- `@daformat/point-and-shoot/markdown` has types under TypeScript's older `moduleResolution: "node"` too, which doesn't read `exports` (a `typesVersions` map).
- d5bd5f8: Update default pointer size
- 91748ee: A selection's lines also give up to one box past a time budget (`maxTime` on `lineRects`, 24ms by default), so a slow machine draws one box sooner instead of stalling.

## 1.0.0

### Major Changes

- 073f34f: Initial release

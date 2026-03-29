Refactor for clarity without changing behavior.

Constraints:
- preserve current behavior
- preserve public types unless necessary
- improve readability
- reduce duplication
- keep business logic in pure functions
- do not move logic into UI components
- update tests if signatures change

If behavior is unclear, stop and identify the ambiguity before changing logic.
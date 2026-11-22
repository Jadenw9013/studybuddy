# Handoff revision 2 · synchronization manifest

Revision: 2. Date: November 16, 2026. Paths are relative to the project root containing AGENTS.md. Hashes are SHA-256 of exact UTF-8 file bytes. The first digest describes the original distribution. The earlier standalone stack audit also has a known base. A dash marks a newly introduced path. The manifest itself is protected by the externally supplied ZIP SHA-256.

## Update an existing extraction

1. Inspect the supplied ZIP before copying. Check its SHA-256 against the value in the founder's kickoff prompt, ensure all members are regular handoff files at relative paths, and read this manifest. Stage it in a temporary directory outside the project. Match a local tree by its README, AGENTS and numbered docs to avoid creating a nested project.
2. If an entry matches the revision-2 digest, skip it. If it matches the prior digest or is absent, copy the staged revision-2 file. Normalize line endings for comparison if the only difference is CRLF. Keep the new manifest at the project root.
3. If a local file has substantive edits, compare its contents with the staged file and preserve the user's changes while merging these decisions. Use the original ZIP or Git history as a merge base if available. A conflict that would discard a deliberate product decision is material. Record the file and both choices; continue unaffected work. Keep unrelated code, notes, untracked files and local configuration untouched.
4. Verify canonical files against the revision-2 column, verify deliberate merges semantically, and list any exceptions. Repeating the preflight on a synchronized project should produce no changes. Implement the product from the synchronized working tree.

| Repository path | Earlier SHA-256 | Revision 2 SHA-256 |
|---|---|---|
| `README.md` | 2d238469c385e9dea418006f6da0b14b5fcdebb2ff20597be2ee53ad86f03b65 | 339232b9370702355a6233acdad0d6130155710b5cf53045c80b0aca838ddef6 |
| `AGENTS.md` | 261590f15a916ab49190555e8a193194025548862477e75d6714083eda29f0be | d0aa5e58f6f45ba6a580bd24b491348e23646fed1e22810b6f2c679a5d684a77 |
| `tutor-stack-audit.md` | ee0a59aa26c15c947411196cb34dc83f004f7be6ea02fdeb74b627b6cc025427 | c4a62c2394569cb21a81bc124f9d38cf355acd7d6b2961a873d439dfd7968893 |
| `docs/01-product.md` | cdfbfc45c988251b9bef8c93cec3b01d3efb12e835e9c30b41313c44c0c4b6f0 | 6a63d8ee8a9f0e028eb7a7c4bfd55411f74cc9547b1200b5b795ab972dd31778 |
| `docs/02-teaching.md` | 7a1d3d6064b4051fb838f1ae8ee12c3b526e0a1d05152d2706406aa7777acf5a | 2e584f81839afd8ce81394763ecc6a49b507e66bd9121f7983d1b8f69d56421b |
| `docs/03-experience.md` | e136022491cfe5740a3371b9a2076f43e458c7a9f29a7cc3e27e86a65b538ebb | 634ba283769e6a7116e7d090104739a5439cbe79787b7ee64e445cba72de9c52 |
| `docs/04-architecture.md` | 9c97a6259a698266704e1973b540e53190295264271720241ad3111fed9059f7 | 015e404f6f4c6cf0126d29fb28c40e7b20f29c21f90c3c4282fe3097aa8ec8a0 |
| `docs/05-data.md` | 163efa3c7f314daa5cbdf29ebf1c5af589e7672fa4c87eb943871f1623aa63e6 | f4e2a81626cc486cde35f9b079820f9dd4120c8a06810978262daf3bdd6b041a |
| `docs/06-live-tools.md` | 64445b9d205426d8edaf67475e40859c6ea4e616b6a0fe02d642d9e3631850a4 | fa253ac14920b7587c40bbd2fafd0953ac52ab7df113de4683dab6b071e27506 |
| `docs/07-operations.md` | ec8d4c5aae57af8f19dfcbf58bd8cbe116e51133a2c525e347207a29c41b8659 | a9aa8e5318a99feff1180845764f35412c2c3c46c2fceefa45a9b15e031e44bb |
| `docs/08-build.md` | 6b115a7e38611ab4ef9252737433b7bc7635ae9182c2198ba838d2c04b97efa4 | 080b44563f9298400881c0659b9a9a5539f9b9c99bf052d203991a08d16a6abf |
| `docs/09-evaluation.md` | 25213e7abc0cf7a5b092487a4aa27876c6356c959889ff83d0f85f2414f0725c | 3948a776afe364e4733a052d1e60e37aa940dbae2c367bbe725e1ca5b132ef9e |
| `docs/10-roadmap.md` | 6cf64169714eb473985fca5808e9d510803dcb2feacf5c3904e7730554a954ce | 6cf64169714eb473985fca5808e9d510803dcb2feacf5c3904e7730554a954ce |
| `docs/11-evidence.md` | fef8d8de34002bd72cd8cd0866e9ddae3c7bd3b10bf147c8fd96ad507cdcb940 | b0690d73ab30d9c3fc39d1797fd3990eb58af78829ef70cea9afd8396e630940 |
| `docs/12-tool-audit.md` | - | 4a32d2be387616c9793db3933a63288138fa3c574a353355bf80626ac5e6fcc4 |

The original archive had 13 documents. Revision 2 contains these 15 handoff documents plus this manifest. The optional Jupyter companion and future Canvas/email planner and disability-focused work retain their existing scope.

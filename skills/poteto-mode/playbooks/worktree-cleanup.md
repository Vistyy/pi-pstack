### Worktree cleanup

**You own the disk and the safety gate.**
Prune merged or abandoned Git worktrees without deleting active Pi sessions or uncommitted work.

1. Snapshot disk usage with `df -h /` and derive candidates from `git worktree list --porcelain` or `herdr worktree list`.
Never construct candidate paths from naming conventions.
2. Call `list_agents` and inspect Herdr workspaces before classifying a worktree as unused.
Use `pstack_sessions` when a saved Pi session must be reconciled with a candidate branch or path.
3. For each candidate, record its branch, merge state, PR state, tracked changes, untracked files, owning Herdr workspace, and newest relevant Pi session.
A clean merged branch with no live owner is removable.
An active worker, open PR, uncertain ownership, or any uncommitted data is a hold.
4. Show the exact diff and untracked file list before asking about irreversible loss.
Do not treat untracked files as disposable without evidence.
5. Prefer `herdr worktree remove --workspace <id>` for a Herdr-owned worktree because Herdr owns that workspace lifecycle.
Use `git worktree remove <derived-path>` for an ordinary Git worktree.
Use `--force` only after explicit confirmation that no uncommitted state must survive.
6. Run `git worktree prune`, re-list the authoritative worktree state, and compare `df -h /` with the initial snapshot.
7. Treat package-manager caches and build outputs as separate cleanup targets.
Derive their exact paths from the owning tool, inspect their current use, and request confirmation before recursive deletion.

**Reply:** show disk usage before and after, every removed worktree with its authoritative owner and branch, and every held candidate with the reason.

export function ensureDependenciesInstalled(): void {
  try {
    import.meta.resolve("commander");
  } catch {
    throw new Error("The pi-pstack package is missing its commander runtime dependency. Reinstall pi-pstack instead of mutating the installed skill directory.");
  }
}

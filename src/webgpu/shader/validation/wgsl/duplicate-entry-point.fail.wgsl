# v-0020 - Duplicate entry point <name, stage> pair.

entry_point fragment = main;
entry_point fragment as "main" = frag_main;

fn frag_main() -> void {
  return;
}

fn main() -> void {
  return;
}

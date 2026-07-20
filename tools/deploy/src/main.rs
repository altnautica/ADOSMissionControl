//! `ados-deploy` entry point.

use ados_deploy::cli::{Args, RunMode};
use ados_deploy::ui::Theme;
use ados_deploy::{deploy, env, menu};

fn main() -> anyhow::Result<()> {
    let args = Args::from_env();
    let theme = Theme::detect(args.no_color, args.ascii);
    let cwd = std::env::current_dir().unwrap_or_else(|_| ".".into());
    let repo_root = env::find_repo_root(&cwd).unwrap_or(cwd);

    match RunMode::from_action(&args) {
        RunMode::Menu => menu::run(&theme, &repo_root, &args)?,
        RunMode::Deploy | RunMode::Reconfigure => deploy::run_wizard(&theme, &repo_root, &args)?,
        // Upgrade / Restart / Teardown / Status land in Phases 3-4; until then
        // they open the menu.
        _ => menu::run(&theme, &repo_root, &args)?,
    }
    Ok(())
}

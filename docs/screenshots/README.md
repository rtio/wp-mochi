# Screenshots

This directory is where screenshots of Mochi in action should live so the main README and other docs can reference them.

## What to capture (once you have a working dev environment)

Recommended set:

| File | What it shows |
| --- | --- |
| `stage.png` | The floating pet in the bottom-right corner of any wp-admin page |
| `settings.png` | The Mochi menu page with personality picker, API key input, reset buttons |
| `evolution.png` | The evolution flash banner when the pet advances a stage |
| `final-forms.png` | A 2×2 grid of the four personality-branched final form sprites (grumpy / chipper / deadpan / dramatic) |
| `peek-handle.png` | The collapsed peek handle state after clicking minimize |

## How to take them

1. `pnpm start` — boots wp-env at http://localhost:8888
2. Log in as `admin` / `password`
3. For `stage.png`: navigate to Dashboard, wait for the floating pet to appear bottom-right, crop to just the widget + a little surrounding wp-admin chrome
4. For `settings.png`: click "Mochi" in the sidebar
5. For `evolution.png`: use `pnpm run env:cli -- mochi set_stage final_form` to jump stages, then interact and capture the flash banner
6. For `final-forms.png`: cycle through personalities via the sidebar dropdown while at `final_form` stage — each personality re-renders the sprite immediately
7. For `peek-handle.png`: click the minimize button on the floating widget

## Format

- PNG preferred (lossless, widely supported by GitHub's markdown renderer)
- 2× resolution for Retina clarity if you can manage it — GitHub will serve them at display resolution
- Keep file sizes reasonable (<500KB each) so cloning the repo doesn't pull down megabytes

## Updating the main README

After adding screenshots here, uncomment the `## Screenshots` section in the main `README.md` and reference them with relative paths like `docs/screenshots/stage.png`.

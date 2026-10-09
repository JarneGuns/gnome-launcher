# Launcher

A `rofi -show drun` style app launcher, built as a GNOME Shell extension (GNOME 50, Wayland).
Press Alt+Space, type a name, pick with the arrow keys and launch with Enter.

![screenshot](screenshot.png)

## Installation

```sh
make install                     # compiles the schemas and symlinks into ~/.local/share/gnome-shell/extensions/
# log out and back in (Wayland)
gnome-extensions enable launcher@jarne
```

GNOME uses Alt+Space for the window menu by default. Disable that shortcut so the launcher can use it:

```sh
gsettings set org.gnome.desktop.wm.keybindings activate-window-menu "[]"
```

To restore it: `gsettings reset org.gnome.desktop.wm.keybindings activate-window-menu`.

Alt+Space still does nothing? Check for a custom shortcut on Alt+Space under Settings → Keyboard → Keyboard Shortcuts → Custom Shortcuts. Such a shortcut keeps the key taken. Remove it, then restart the extension:

```sh
gnome-extensions disable launcher@jarne && gnome-extensions enable launcher@jarne
```

## Keys

| Key | Action |
|---|---|
| Alt+Space | Open or close |
| Typing | Filter live |
| ↑ / ↓, Ctrl+K / Ctrl+J | Move the selection (wraps around) |
| Page Up / Page Down | Jump one page |
| Enter / click | Activate and close |
| Ctrl+Enter | Activate, keep the launcher open |
| Escape / click outside | Close |
| Tab / Shift+Tab | Switch mode |

## Modes

- **drun**: launch apps. If the app is already running, you get a new window.
- **window**: jump to an open window. Search by app name or window title.
- **run**: run a command. Enter runs it in a terminal, Shift+Enter runs it in the background. A command with arguments (`ping 1.1.1.1`) runs exactly as typed.
- **files**: open files in their default app. An empty query shows your recent files. With at least 3 letters, results from the GNOME file index (LocalSearch) are added after a short pause. Hidden folders and `node_modules` are skipped.

**Calculator:** type a calculation such as `12*7` or `(3+4)^2` in drun. The result appears as the first row and Enter copies it to the clipboard.

## Settings

Open them with `gnome-extensions prefs launcher@jarne`. You can set the shortcut, the theme (dark, light, spring, summer, autumn, winter, or "season", which follows the calendar), the width, the maximum number of rows, icons, the terminal for run mode and fuzzy matching.

## Ranking

The ranking lives in `search.js`, from best to weakest match:

1. Exact name.
2. The name starts with the query.
3. A word in the name starts with the query.
4. The name contains the query.
5. A match on keywords, generic name or executable.
6. Fuzzy: subsequence or small typos. Only used when levels 1–5 find nothing.

On equal scores, higher usage wins first, then the shorter name.

## Development

```sh
make test     # unit tests for search.js and calc.js (gjs -m)
make schemas  # compile the schemas
make pack     # zip for distribution
make logs     # follow the gnome-shell logs
make nested   # nested shell (needs the devkit package)
```

`make nested` needs the devkit package: `mutter-devkit` on Fedora, `mutter-dev-bin` on Ubuntu.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {LauncherWindow} from './launcherWindow.js';

export default class LauncherExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._window = new LauncherWindow(this._settings);

        // POPUP is the action mode of the open launcher itself, so the same
        // shortcut can close it again.
        Main.wm.addKeybinding('toggle-launcher', this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this._toggle());
    }

    disable() {
        Main.wm.removeKeybinding('toggle-launcher');
        this._window.destroy();
        this._window = null;
        this._settings = null;
    }

    _toggle() {
        if (this._window.isOpen) {
            this._window.close();
            return;
        }

        // Don't open on top of another popup menu.
        if (Main.actionMode === Shell.ActionMode.NORMAL ||
            Main.actionMode === Shell.ActionMode.OVERVIEW)
            this._window.open();
    }
}

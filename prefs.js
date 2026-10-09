import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const THEMES = ['dark', 'light', 'spring', 'summer', 'autumn', 'winter', 'season'];

export default class LauncherPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({title: 'Launcher'});
        page.add(group);
        window.add(page);

        // Shortcut as an accelerator string, e.g. <Alt>space or <Super>d.
        const shortcut = new Adw.EntryRow({
            title: 'Shortcut (e.g. <Alt>space)',
            show_apply_button: true,
            text: settings.get_strv('toggle-launcher')[0] ?? '',
        });
        shortcut.connect('apply', () => {
            const accel = shortcut.text.trim();
            const [ok] = Gtk.accelerator_parse(accel);
            if (ok && accel !== '') {
                shortcut.remove_css_class('error');
                settings.set_strv('toggle-launcher', [accel]);
            } else {
                shortcut.add_css_class('error');
            }
        });
        group.add(shortcut);

        const theme = new Adw.ComboRow({
            title: 'Theme',
            model: Gtk.StringList.new(['Dark', 'Light', 'Spring', 'Summer', 'Autumn', 'Winter',
                'Season (follows the calendar)']),
            selected: Math.max(0, THEMES.indexOf(settings.get_string('theme'))),
        });
        theme.connect('notify::selected', () =>
            settings.set_string('theme', THEMES[theme.selected]));
        group.add(theme);

        const rows = Adw.SpinRow.new_with_range(3, 50, 1);
        rows.title = 'Maximum visible rows';
        settings.bind('max-rows', rows, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(rows);

        const width = Adw.SpinRow.new_with_range(10, 100, 5);
        width.title = 'Width (% of screen)';
        settings.bind('width', width, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(width);

        const icons = new Adw.SwitchRow({title: 'Show icons'});
        settings.bind('show-icons', icons, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(icons);

        const terminal = new Adw.EntryRow({title: 'Terminal for run mode (empty = automatic)'});
        settings.bind('terminal', terminal, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(terminal);

        const fuzzy = new Adw.SwitchRow({
            title: 'Fuzzy matching',
            subtitle: 'Find apps with typos, e.g. "frefox"',
        });
        settings.bind('fuzzy', fuzzy, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(fuzzy);
    }
}

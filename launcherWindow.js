import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {calculate} from './calc.js';
import {MODES} from './modes.js';
import {rankApps} from './search.js';

// Rendering thousands of rows (run mode) is slow; the counter still shows
// the real number of matches.
const MAX_RENDERED_ROWS = 200;
const ICON_SIZE = 18;
const MIN_WIDTH = 400;
// Wait for a pause in typing before asking the file index.
const SEARCH_DELAY_MS = 250;

// St cannot draw dashed borders, so the rofi separator is drawn with cairo.
// The line color comes from the CSS `color` property.
const DashedLine = GObject.registerClass({
    GTypeName: 'LauncherJarneDashedLine',
}, class DashedLine extends St.DrawingArea {
    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        cr.setSourceColor(this.get_theme_node().get_foreground_color());
        cr.setLineWidth(height);
        cr.setDash([4, 4], 0);
        cr.moveTo(0, height / 2);
        cr.lineTo(width, height / 2);
        cr.stroke();
        cr.$dispose();
    }
});

// "season" follows the meteorological seasons: spring starts in March.
const SEASONS = ['winter', 'spring', 'summer', 'autumn'];

function resolveTheme(theme) {
    if (theme !== 'season')
        return theme;
    const month = new Date().getMonth(); // 0 = January
    return SEASONS[Math.floor((month + 1) % 12 / 3)];
}

export class LauncherWindow {
    constructor(settings) {
        this._settings = settings;
        this._backdrop = null;
        this._grab = null;
        this._searchTimeoutId = 0;
        this._cancellable = null;
    }

    get isOpen() {
        return this._backdrop !== null;
    }

    open() {
        if (this.isOpen)
            return;

        this._modeIndex = 0;
        this._items = new Map();
        this._results = [];
        this._rows = [];
        this._selected = -1;
        this._maxRows = this._settings.get_int('max-rows');
        this._fuzzy = this._settings.get_boolean('fuzzy');
        this._showIcons = this._settings.get_boolean('show-icons');
        const theme = resolveTheme(this._settings.get_string('theme'));
        const widthPercent = this._settings.get_int('width');

        const monitor = Main.layoutManager.currentMonitor;

        // Full-monitor transparent backdrop: it holds the modal grab and
        // closes the launcher when clicked outside the window.
        this._backdrop = new St.Widget({
            reactive: true,
            layout_manager: new Clutter.BinLayout(),
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
        });
        this._backdrop.connect('button-press-event', () => {
            this.close();
            return Clutter.EVENT_STOP;
        });

        const width = Math.max(MIN_WIDTH, Math.round(monitor.width * widthPercent / 100));
        const box = new St.BoxLayout({
            style_class: `launcher-window ${theme}`,
            orientation: Clutter.Orientation.VERTICAL,
            width: Math.min(width, monitor.width),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        // Clicks inside the window must not reach the backdrop.
        box.connect('button-press-event', () => Clutter.EVENT_STOP);
        this._backdrop.add_child(box);

        const header = new St.BoxLayout({style_class: 'launcher-header'});
        this._prompt = new St.Label({
            style_class: 'launcher-prompt',
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._prompt);
        this._entry = new St.Entry({
            style_class: 'launcher-entry',
            hint_text: 'Type to filter',
            can_focus: true,
            x_expand: true,
        });
        header.add_child(this._entry);
        this._counter = new St.Label({
            style_class: 'launcher-counter',
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._counter);
        box.add_child(header);

        box.add_child(new DashedLine({style_class: 'launcher-separator', x_expand: true}));

        this._list = new St.BoxLayout({
            style_class: 'launcher-list',
            orientation: Clutter.Orientation.VERTICAL,
        });
        this._scroll = new St.ScrollView({
            style_class: 'launcher-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            child: this._list,
        });
        box.add_child(this._scroll);

        this._entry.clutter_text.connect('text-changed', () => this._update());
        this._entry.clutter_text.connect('key-press-event', (_actor, event) => this._onKeyPress(event));

        Main.uiGroup.add_child(this._backdrop);

        this._grab = Main.pushModal(this._backdrop, {actionMode: Shell.ActionMode.POPUP});
        this._entry.grab_key_focus();

        // Fixed height like rofi: always room for max-rows rows. Every row
        // gets the height of a row with an icon, so all modes line up.
        const probe = this._createRow({name: 'X', iconName: 'application-x-executable'}, 0);
        this._list.add_child(probe);
        this._rowHeight = probe.get_preferred_height(-1)[1];
        probe.destroy();
        this._scroll.height = this._rowHeight * this._maxRows;

        this._update();
    }

    close() {
        if (!this.isOpen)
            return;

        this._cancelSearch();

        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }

        this._backdrop.destroy();
        this._backdrop = null;
        this._prompt = null;
        this._entry = null;
        this._counter = null;
        this._list = null;
        this._scroll = null;
        this._rows = [];
        this._results = [];
        this._items = null;
    }

    toggle() {
        if (this.isOpen)
            this.close();
        else
            this.open();
    }

    destroy() {
        this.close();
        this._settings = null;
    }

    get _mode() {
        return MODES[this._modeIndex];
    }

    // Items are loaded once per open, the first time a mode is shown.
    _itemsFor(mode) {
        if (!this._items.has(mode))
            this._items.set(mode, mode.load());
        return this._items.get(mode);
    }

    _switchMode(delta) {
        this._modeIndex = (this._modeIndex + delta + MODES.length) % MODES.length;
        this._update();
    }

    _update() {
        const mode = this._mode;
        const query = this._entry.text;
        const items = this._itemsFor(mode);

        this._prompt.text = `${mode.name}:`;
        this._render(rankApps(items, query, {fuzzy: this._fuzzy}), items.length, 0);
        this._scheduleSearch(mode, query, items);
    }

    // Modes with a search() hook (files) add results asynchronously.
    _scheduleSearch(mode, query, items) {
        this._cancelSearch();
        if (!mode.search || query.trim() === '')
            return;

        this._searchTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEARCH_DELAY_MS, () => {
            this._searchTimeoutId = 0;
            const cancellable = new Gio.Cancellable();
            this._cancellable = cancellable;

            mode.search(query, cancellable).then(found => {
                if (cancellable.is_cancelled())
                    return;
                this._cancellable = null;

                const known = new Set(items.map(item => item.id));
                const all = [...items, ...found.filter(item => !known.has(item.id))];
                const results = rankApps(all, query, {fuzzy: this._fuzzy});
                // Keep the same item selected, even if new results land above it.
                const selectedId = this._results[this._selected]?.id;
                const selected = Math.max(0, results.findIndex(item => item.id === selectedId));
                this._render(results, items.length, selected);
            }).catch(e => {
                if (!cancellable.is_cancelled())
                    logError(e, 'launcher: file search failed');
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelSearch() {
        if (this._searchTimeoutId) {
            GLib.source_remove(this._searchTimeoutId);
            this._searchTimeoutId = 0;
        }
        this._cancellable?.cancel();
        this._cancellable = null;
    }

    _render(results, total, selected) {
        const mode = this._mode;
        const query = this._entry.text;
        this._results = results;

        if (mode.name === 'drun') {
            const result = calculate(query);
            if (result !== null) {
                this._results.unshift({
                    name: `= ${result}`,
                    genericName: 'Enter to copy',
                    iconName: 'accessories-calculator-symbolic',
                    calc: result,
                });
            }
        }

        this._list.destroy_all_children();
        this._rows = this._results
            .slice(0, MAX_RENDERED_ROWS)
            .map((item, i) => this._createRow(item, i));
        this._rows.forEach(row => this._list.add_child(row));

        this._counter.text = `${this._results.length}/${total}`;

        this._selected = -1;
        if (selected === 0)
            this._scroll.vadjustment.value = 0;
        this._select(selected);
    }

    _createRow(item, index) {
        const row = new St.BoxLayout({
            style_class: `launcher-row ${index % 2 ? 'alternate' : 'normal'}`,
            reactive: true,
            track_hover: true,
        });
        if (this._rowHeight)
            row.height = this._rowHeight;

        if (this._showIcons && (item.gicon || item.iconName)) {
            row.add_child(new St.Icon({
                gicon: item.gicon ?? null,
                icon_name: item.gicon ? null : item.iconName,
                icon_size: ICON_SIZE,
                style_class: 'launcher-icon',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        row.add_child(new St.Label({
            text: item.name,
            style_class: 'launcher-name',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const detail = item.genericName || item.detail;
        if (detail && detail !== item.name) {
            row.add_child(new St.Label({
                text: `(${detail})`,
                style_class: 'launcher-generic',
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            }));
        }
        row.connect('button-release-event', () => {
            this._activate(index, {close: true, shift: false});
            return Clutter.EVENT_STOP;
        });
        return row;
    }

    _select(index) {
        if (this._rows.length === 0) {
            this._selected = -1;
            return;
        }

        index = Math.max(0, Math.min(index, this._rows.length - 1));
        this._rows[this._selected]?.remove_style_class_name('selected');
        this._rows[index].add_style_class_name('selected');
        this._selected = index;

        // Rows all have the same height, so we can scroll without waiting
        // for an allocation.
        const adjustment = this._scroll.vadjustment;
        const pageSize = this._rowHeight * this._maxRows;
        const top = index * this._rowHeight;
        const bottom = top + this._rowHeight;
        if (top < adjustment.value)
            adjustment.value = top;
        else if (bottom > adjustment.value + pageSize)
            adjustment.value = bottom - pageSize;
    }

    // Single steps wrap around like rofi; page steps stop at the ends.
    _move(delta, wrap) {
        const count = this._rows.length;
        if (count === 0)
            return;

        let index = this._selected + delta;
        if (wrap)
            index = (index + count) % count;
        this._select(index);
    }

    _activate(index, {close, shift}) {
        const item = this._results[index];
        const mode = this._mode;
        const query = this._entry.text;
        const terminal = this._settings.get_string('terminal');

        // Run mode can also run a typed command that is not in the list.
        if (!item && mode.name !== 'run')
            return;

        if (close)
            this.close();

        if (item?.calc !== undefined)
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, item.calc);
        else
            mode.activate(item, {query, shift, terminal});
    }

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        const state = event.get_state();
        const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
        const alt = (state & Clutter.ModifierType.MOD1_MASK) !== 0;

        switch (symbol) {
        case Clutter.KEY_Escape:
            this.close();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_ISO_Enter:
            this._activate(this._selected, {close: !ctrl, shift});
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Tab:
            this._switchMode(1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_ISO_Left_Tab:
            this._switchMode(-1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            this._move(-1, true);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
            this._move(1, true);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Up:
            this._move(-this._maxRows, false);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Down:
            this._move(this._maxRows, false);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_k:
        case Clutter.KEY_K:
            if (!ctrl)
                break;
            this._move(-1, true);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_j:
        case Clutter.KEY_J:
            if (!ctrl)
                break;
            this._move(1, true);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_space:
            // Fallback in case the keybinding does not fire while modal.
            if (!alt)
                break;
            this.close();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }
}

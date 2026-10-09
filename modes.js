// The rofi modes: drun (apps), window (open windows) and run (commands).
// Each mode loads plain items for search.js and knows how to activate one.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

// File access in shell code must be asynchronous: synchronous IO would block
// the whole desktop while it waits for the disk.
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'query_info_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

// Tried in order when the terminal setting is empty.
const TERMINALS = ['ghostty', 'x-terminal-emulator', 'ptyxis', 'gnome-terminal',
    'kgx', 'konsole', 'alacritty', 'kitty', 'foot', 'xterm'];

// Terminals that take the command after "--" instead of "-e".
const DASH_DASH_TERMINALS = ['gnome-terminal', 'ptyxis'];

function terminalArgv(setting, command) {
    const terminal = setting || TERMINALS.find(t => GLib.find_program_in_path(t)) || 'xterm';
    const [, argv] = GLib.shell_parse_argv(terminal);
    const separator = DASH_DASH_TERMINALS.includes(GLib.path_get_basename(argv[0])) ? '--' : '-e';
    // Keep the terminal open with a shell after the command ends, so its
    // output stays visible.
    return [...argv, separator, 'sh', '-c', `${command}; exec "\${SHELL:-sh}"`];
}

const drunMode = {
    name: 'drun',

    async load() {
        const mostUsed = Shell.AppUsage.get_default().get_most_used();
        const usage = new Map(mostUsed.map((app, i) => [app.get_id(), mostUsed.length - i]));

        return Shell.AppSystem.get_default().get_installed()
            .filter(info => info.should_show())
            .map(info => ({
                id: info.get_id(),
                name: info.get_display_name() || info.get_name(),
                genericName: info.get_generic_name?.() ?? '',
                keywords: info.get_keywords?.() ?? [],
                executable: info.get_executable() ?? '',
                usage: usage.get(info.get_id()) ?? 0,
                gicon: info.get_icon(),
            }));
    },

    activate(item) {
        const app = Shell.AppSystem.get_default().lookup_app(item.id);
        if (!app)
            return;

        // Like rofi: a running app gets a new window instead of focus.
        // Apps that only allow one window are focused instead.
        if (app.get_state() === Shell.AppState.RUNNING && app.can_open_new_window())
            app.open_new_window(-1);
        else
            app.activate();
        Main.overview.hide();
    },
};

const windowMode = {
    name: 'window',

    async load() {
        const tracker = Shell.WindowTracker.get_default();
        // Same filtering as the Alt+Tab switcher, in most-recently-used order.
        const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .map(w => w.is_attached_dialog() ? w.get_transient_for() : w)
            .filter((w, i, all) => !w.skip_taskbar && all.indexOf(w) === i);

        return windows.map((win, i) => {
            const app = tracker.get_window_app(win);
            return {
                id: `window-${win.get_id()}`,
                name: app?.get_name() ?? win.get_wm_class() ?? '',
                genericName: win.get_title() ?? '',
                usage: windows.length - i,
                gicon: app?.get_icon() ?? null,
                window: win,
            };
        });
    },

    activate(item) {
        Main.activateWindow(item.window);
        Main.overview.hide();
    },
};

// Names of the executables in `dir`, or [] when it is missing or unreadable.
async function listExecutables(dir) {
    const names = [];
    try {
        const children = await Gio.File.new_for_path(dir).enumerate_children_async(
            'standard::name,standard::type,access::can-execute',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null);
        let infos;
        while ((infos = await children.next_files_async(100, GLib.PRIORITY_DEFAULT, null)).length > 0) {
            for (const info of infos) {
                if (info.get_file_type() !== Gio.FileType.DIRECTORY &&
                    info.get_attribute_boolean('access::can-execute'))
                    names.push(info.get_name());
            }
        }
        await children.close_async(GLib.PRIORITY_DEFAULT, null);
    } catch {
        // Missing or unreadable PATH entry.
    }
    return names;
}

async function fileExists(uri) {
    try {
        await Gio.File.new_for_uri(uri).query_info_async('standard::type',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null);
        return true;
    } catch {
        return false;
    }
}

const runMode = {
    name: 'run',

    async load() {
        const dirs = (GLib.getenv('PATH') ?? '').split(':').filter(Boolean);
        const lists = await Promise.all(dirs.map(listExecutables));
        const names = new Set(lists.flat());
        return [...names].map(name => ({id: name, name, usage: 0}));
    },

    // Enter runs in a terminal, Shift+Enter in the background. A query with
    // arguments ("ping 1.1.1.1") is run as typed.
    activate(item, {query, shift, terminal}) {
        query = query.trim();
        const command = query.includes(' ') || !item ? query : item.name;
        if (!command)
            return;

        if (shift)
            Util.spawnCommandLine(command);
        else
            Util.spawn(terminalArgv(terminal, command));
    },
};

const RECENT_FILES = GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
const MAX_RECENT = 500;
const MAX_INDEX_RESULTS = 500;
// Shorter prefixes make LocalSearch scan a huge part of the index.
const MIN_INDEX_TERM = 3;

const INDEX_QUERY = `SELECT DISTINCT ?url WHERE {
    ?f a nfo:FileDataObject ; fts:match ~q ; nie:url ?url .
} LIMIT ${MAX_INDEX_RESULTS}`;

const XML_ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};

function unescapeXml(text) {
    return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => XML_ENTITIES[name]);
}

// Turns a file:// URI into a launcher item. `usage` breaks ranking ties.
function fileItem(uri, usage) {
    const file = Gio.File.new_for_uri(uri);
    const name = file.get_basename();
    const dir = file.get_parent()?.get_path() ?? '';
    const home = GLib.get_home_dir();
    const [contentType] = Gio.content_type_guess(name, null);
    return {
        id: uri,
        name,
        detail: dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir,
        usage,
        gicon: Gio.content_type_get_icon(contentType),
        uri,
    };
}

// Skip hidden folders and dependency trees, they drown real results.
function isNoise(uri) {
    return /\/\.|\/node_modules\//.test(uri);
}

const filesMode = {
    name: 'files',

    // Recently used files, newest first.
    async load() {
        let xml;
        try {
            const [bytes] = await Gio.File.new_for_path(RECENT_FILES).load_contents_async(null);
            xml = new TextDecoder().decode(bytes);
        } catch {
            return [];
        }

        const candidates = [...xml.matchAll(/<bookmark href="([^"]+)"[^>]*?modified="([^"]+)"/g)]
            .map(([, href, modified]) => ({uri: unescapeXml(href), modified}))
            .filter(r => r.uri.startsWith('file://') && !isNoise(r.uri))
            .sort((a, b) => b.modified.localeCompare(a.modified))
            .slice(0, MAX_RECENT);
        const exists = await Promise.all(candidates.map(r => fileExists(r.uri)));
        const recent = candidates.filter((_, i) => exists[i]);

        return recent.map((r, i) => fileItem(r.uri, recent.length - i));
    },

    // Searches the GNOME file index (LocalSearch). Resolves to more items.
    async search(query, cancellable) {
        const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
        if (!terms.some(t => t.length >= MIN_INDEX_TERM))
            return [];

        let proc;
        try {
            proc = Gio.Subprocess.new([
                'tinysparql', 'query', '-b', 'org.freedesktop.LocalSearch3',
                '-a', `q:s:${terms.map(t => `${t}*`).join(' ')}`,
                '-q', INDEX_QUERY,
            ], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch {
            // tinysparql is not installed: only recent files are available.
            return [];
        }
        const cancelId = cancellable.connect(() => proc.force_exit());

        try {
            const [stdout] = await proc.communicate_utf8_async(null, cancellable);
            // Shallow paths first: ~/Documents/x beats a file deep in an SDK.
            return (stdout ?? '').split('\n')
                .map(line => line.trim())
                .filter(uri => uri.startsWith('file://') && !isNoise(uri))
                .map(uri => fileItem(uri, -uri.split('/').length));
        } finally {
            cancellable.disconnect(cancelId);
        }
    },

    activate(item) {
        if (!item)
            return;
        Gio.AppInfo.launch_default_for_uri_async(item.uri,
            global.create_app_launch_context(0, -1), null, (_source, result) => {
                try {
                    Gio.AppInfo.launch_default_for_uri_finish(result);
                } catch (e) {
                    Main.notifyError('Could not open file', e.message);
                }
            });
        Main.overview.hide();
    },
};

export const MODES = [drunMode, windowMode, runMode, filesMode];

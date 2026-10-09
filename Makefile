UUID := launcher@jarne
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: install schemas pack test logs nested

install: schemas
	ln -sfn "$(CURDIR)" "$(INSTALL_DIR)"
	@echo "Linked to $(INSTALL_DIR). Log out and back in, then: gnome-extensions enable $(UUID)"

schemas:
	glib-compile-schemas --strict schemas/

pack:
	gnome-extensions pack --force \
		--extra-source=launcherWindow.js \
		--extra-source=search.js \
		--extra-source=modes.js \
		--extra-source=calc.js \
		.

test:
	gjs -m tests/search.test.js
	gjs -m tests/calc.test.js

logs:
	journalctl -f -o cat /usr/bin/gnome-shell

nested:
	dbus-run-session -- gnome-shell --devkit --wayland

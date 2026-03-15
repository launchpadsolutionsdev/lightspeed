/* ============================================================
   LIGHTSPEED MODAL SYSTEM
   Premium replacement for browser confirm/alert/prompt dialogs.
   Returns Promises so existing async flows work unchanged.
   ============================================================ */

(function () {
    'use strict';

    // ── Singleton overlay (created once, reused) ──────────────
    let overlay = null;
    let activeResolve = null;
    let activeCleanup = null;

    function getOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.className = 'ls-modal-overlay';
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) dismissModal(null);
        });
        document.body.appendChild(overlay);
        return overlay;
    }

    function showOverlay(html) {
        const el = getOverlay();
        el.innerHTML = html;
        // Force reflow before adding .show for transition
        void el.offsetHeight;
        el.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function hideOverlay() {
        if (!overlay) return;
        overlay.classList.remove('show');
        document.body.style.overflow = '';
        setTimeout(function () {
            if (overlay) overlay.innerHTML = '';
        }, 250);
    }

    function dismissModal(value) {
        if (activeCleanup) activeCleanup();
        hideOverlay();
        if (activeResolve) {
            activeResolve(value);
            activeResolve = null;
        }
    }

    // ── Keyboard handler ──────────────────────────────────────
    function attachKeyboard(onEnter, onEscape) {
        function handler(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (onEscape) onEscape();
            } else if (e.key === 'Enter' && !e.shiftKey) {
                // Don't trigger Enter on textareas
                if (e.target.tagName === 'TEXTAREA') return;
                e.preventDefault();
                if (onEnter) onEnter();
            }
        }
        document.addEventListener('keydown', handler);
        return function () {
            document.removeEventListener('keydown', handler);
        };
    }

    // ── Icon SVGs ─────────────────────────────────────────────
    const ICONS = {
        danger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        input: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
    };

    // ── Escape HTML ───────────────────────────────────────────
    function esc(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ══════════════════════════════════════════════════════════
    //  PUBLIC API
    // ══════════════════════════════════════════════════════════

    /**
     * lsModal.confirm({ title, message, confirmLabel, cancelLabel, variant })
     * Returns Promise<boolean>
     *
     * variant: 'danger' | 'warning' | 'info' (default: 'warning')
     */
    function lsConfirm(opts) {
        opts = opts || {};
        var title = opts.title || 'Are you sure?';
        var message = opts.message || '';
        var confirmLabel = opts.confirmLabel || 'Confirm';
        var cancelLabel = opts.cancelLabel || 'Cancel';
        var variant = opts.variant || 'warning';

        var iconHtml = ICONS[variant] || ICONS.warning;
        var btnClass = variant === 'danger' ? 'ls-modal-btn-danger' : 'ls-modal-btn-primary';

        var html = '<div class="ls-modal">' +
            '<div class="ls-modal-icon ls-modal-icon-' + variant + '">' + iconHtml + '</div>' +
            '<h3 class="ls-modal-title">' + esc(title) + '</h3>' +
            (message ? '<p class="ls-modal-message">' + esc(message) + '</p>' : '') +
            '<div class="ls-modal-actions">' +
                '<button class="ls-modal-btn ls-modal-btn-secondary" data-action="cancel">' + esc(cancelLabel) + '</button>' +
                '<button class="ls-modal-btn ' + btnClass + '" data-action="confirm">' + esc(confirmLabel) + '</button>' +
            '</div>' +
        '</div>';

        return new Promise(function (resolve) {
            activeResolve = resolve;
            showOverlay(html);

            var modal = overlay.querySelector('.ls-modal');
            modal.querySelector('[data-action="cancel"]').onclick = function () { dismissModal(false); };
            modal.querySelector('[data-action="confirm"]').onclick = function () { dismissModal(true); };
            modal.querySelector('[data-action="confirm"]').focus();

            activeCleanup = attachKeyboard(
                function () { dismissModal(true); },
                function () { dismissModal(false); }
            );
        });
    }

    /**
     * lsModal.confirmDangerous({ title, message, confirmText, confirmLabel })
     * "Type the name to confirm" pattern for high-risk operations.
     * Returns Promise<boolean>
     */
    function lsConfirmDangerous(opts) {
        opts = opts || {};
        var title = opts.title || 'This action cannot be undone';
        var message = opts.message || '';
        var confirmText = opts.confirmText || 'DELETE';
        var confirmLabel = opts.confirmLabel || 'I understand, delete permanently';

        var html = '<div class="ls-modal">' +
            '<div class="ls-modal-icon ls-modal-icon-danger">' + ICONS.danger + '</div>' +
            '<h3 class="ls-modal-title">' + esc(title) + '</h3>' +
            (message ? '<p class="ls-modal-message">' + esc(message) + '</p>' : '') +
            '<div class="ls-modal-input-group">' +
                '<label class="ls-modal-label">Type <strong>' + esc(confirmText) + '</strong> to confirm</label>' +
                '<input type="text" class="ls-modal-input" data-confirm-input autocomplete="off" spellcheck="false" />' +
            '</div>' +
            '<div class="ls-modal-actions">' +
                '<button class="ls-modal-btn ls-modal-btn-secondary" data-action="cancel">Cancel</button>' +
                '<button class="ls-modal-btn ls-modal-btn-danger" data-action="confirm" disabled>' + esc(confirmLabel) + '</button>' +
            '</div>' +
        '</div>';

        return new Promise(function (resolve) {
            activeResolve = resolve;
            showOverlay(html);

            var modal = overlay.querySelector('.ls-modal');
            var input = modal.querySelector('[data-confirm-input]');
            var confirmBtn = modal.querySelector('[data-action="confirm"]');

            input.addEventListener('input', function () {
                confirmBtn.disabled = input.value.trim() !== confirmText;
            });

            modal.querySelector('[data-action="cancel"]').onclick = function () { dismissModal(false); };
            confirmBtn.onclick = function () { if (!confirmBtn.disabled) dismissModal(true); };
            input.focus();

            activeCleanup = attachKeyboard(
                function () { if (!confirmBtn.disabled) dismissModal(true); },
                function () { dismissModal(false); }
            );
        });
    }

    /**
     * lsModal.alert({ title, message, buttonLabel, variant })
     * Returns Promise<void>
     *
     * variant: 'error' | 'warning' | 'info' | 'success'
     */
    function lsAlert(opts) {
        if (typeof opts === 'string') opts = { message: opts };
        opts = opts || {};
        var title = opts.title || (opts.variant === 'error' ? 'Something went wrong' : 'Notice');
        var message = opts.message || '';
        var buttonLabel = opts.buttonLabel || 'OK';
        var variant = opts.variant || 'info';

        var iconHtml = ICONS[variant] || ICONS.info;

        var html = '<div class="ls-modal">' +
            '<div class="ls-modal-icon ls-modal-icon-' + variant + '">' + iconHtml + '</div>' +
            '<h3 class="ls-modal-title">' + esc(title) + '</h3>' +
            (message ? '<p class="ls-modal-message">' + esc(message) + '</p>' : '') +
            '<div class="ls-modal-actions">' +
                '<button class="ls-modal-btn ls-modal-btn-primary" data-action="ok">' + esc(buttonLabel) + '</button>' +
            '</div>' +
        '</div>';

        return new Promise(function (resolve) {
            activeResolve = function () { resolve(); };
            showOverlay(html);

            var modal = overlay.querySelector('.ls-modal');
            modal.querySelector('[data-action="ok"]').onclick = function () { dismissModal(); };
            modal.querySelector('[data-action="ok"]').focus();

            activeCleanup = attachKeyboard(
                function () { dismissModal(); },
                function () { dismissModal(); }
            );
        });
    }

    /**
     * lsModal.prompt({ title, message, placeholder, defaultValue, inputType, label })
     * Returns Promise<string|null>  (null = cancelled)
     */
    function lsPrompt(opts) {
        opts = opts || {};
        var title = opts.title || 'Enter a value';
        var message = opts.message || '';
        var placeholder = opts.placeholder || '';
        var defaultValue = opts.defaultValue || '';
        var inputType = opts.inputType || 'text';
        var label = opts.label || '';
        var confirmLabel = opts.confirmLabel || 'Save';

        var inputHtml;
        if (inputType === 'color') {
            inputHtml =
                '<div class="ls-modal-color-row">' +
                    '<input type="color" class="ls-modal-color-picker" data-prompt-input value="' + esc(defaultValue || '#635BFF') + '" />' +
                    '<input type="text" class="ls-modal-input ls-modal-color-text" data-prompt-hex value="' + esc(defaultValue || '#635BFF') + '" placeholder="#000000" />' +
                '</div>';
        } else if (inputType === 'textarea') {
            inputHtml = '<textarea class="ls-modal-input ls-modal-textarea" data-prompt-input placeholder="' + esc(placeholder) + '">' + esc(defaultValue) + '</textarea>';
        } else {
            inputHtml = '<input type="' + inputType + '" class="ls-modal-input" data-prompt-input placeholder="' + esc(placeholder) + '" value="' + esc(defaultValue) + '" />';
        }

        var html = '<div class="ls-modal">' +
            '<div class="ls-modal-icon ls-modal-icon-input">' + ICONS.input + '</div>' +
            '<h3 class="ls-modal-title">' + esc(title) + '</h3>' +
            (message ? '<p class="ls-modal-message">' + esc(message) + '</p>' : '') +
            '<div class="ls-modal-input-group">' +
                (label ? '<label class="ls-modal-label">' + esc(label) + '</label>' : '') +
                inputHtml +
            '</div>' +
            '<div class="ls-modal-actions">' +
                '<button class="ls-modal-btn ls-modal-btn-secondary" data-action="cancel">Cancel</button>' +
                '<button class="ls-modal-btn ls-modal-btn-primary" data-action="confirm">' + esc(confirmLabel) + '</button>' +
            '</div>' +
        '</div>';

        return new Promise(function (resolve) {
            activeResolve = resolve;
            showOverlay(html);

            var modal = overlay.querySelector('.ls-modal');
            var input = modal.querySelector('[data-prompt-input]');
            var confirmBtn = modal.querySelector('[data-action="confirm"]');

            // Color picker sync
            if (inputType === 'color') {
                var hexInput = modal.querySelector('[data-prompt-hex]');
                input.addEventListener('input', function () {
                    hexInput.value = input.value;
                });
                hexInput.addEventListener('input', function () {
                    if (/^#[0-9a-fA-F]{6}$/.test(hexInput.value)) {
                        input.value = hexInput.value;
                    }
                });
            }

            modal.querySelector('[data-action="cancel"]').onclick = function () { dismissModal(null); };
            confirmBtn.onclick = function () {
                var val = inputType === 'color' ? input.value : input.value;
                dismissModal(val);
            };

            // Focus the input
            if (inputType === 'color') {
                modal.querySelector('[data-prompt-hex]').focus();
                modal.querySelector('[data-prompt-hex]').select();
            } else {
                input.focus();
                if (input.select) input.select();
            }

            activeCleanup = attachKeyboard(
                function () {
                    var val = inputType === 'color' ? input.value : input.value;
                    dismissModal(val);
                },
                function () { dismissModal(null); }
            );
        });
    }

    // ── Expose globally ───────────────────────────────────────
    window.lsModal = {
        confirm: lsConfirm,
        confirmDangerous: lsConfirmDangerous,
        alert: lsAlert,
        prompt: lsPrompt
    };
})();

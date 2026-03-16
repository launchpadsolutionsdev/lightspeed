/* ============================================================
   LIGHTSPEED MICRO-INTERACTIONS
   Skeleton loaders + button loading state utilities
   ============================================================ */

(function () {
    'use strict';

    // ── Skeleton Loaders ──────────────────────────────────────

    /**
     * Generate skeleton HTML for common patterns.
     * Usage: lsMicro.skeleton('posts', 3) → HTML string of 3 skeleton posts
     */
    function skeleton(type, count) {
        count = count || 3;
        var items = '';

        switch (type) {
            case 'posts':
                for (var i = 0; i < count; i++) {
                    items += '<div class="skeleton-post">' +
                        '<div class="skeleton-post-header">' +
                            '<div class="skeleton-post-avatar skeleton-shimmer"></div>' +
                            '<div class="skeleton-post-meta">' +
                                '<div class="skeleton-post-name skeleton-shimmer"></div>' +
                                '<div class="skeleton-post-date skeleton-shimmer"></div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="skeleton-post-body skeleton-shimmer"></div>' +
                        '<div class="skeleton-post-body-short skeleton-shimmer"></div>' +
                    '</div>';
                }
                break;

            case 'list':
                for (var j = 0; j < count; j++) {
                    items += '<div class="skeleton-list-item">' +
                        '<div class="skeleton-list-icon skeleton-shimmer"></div>' +
                        '<div class="skeleton-list-text skeleton-shimmer"></div>' +
                    '</div>';
                }
                break;

            case 'cards':
                for (var k = 0; k < count; k++) {
                    items += '<div class="skeleton-card">' +
                        '<div class="skeleton-title skeleton-shimmer"></div>' +
                        '<div class="skeleton-text skeleton-shimmer"></div>' +
                        '<div class="skeleton-text skeleton-shimmer" style="width:70%"></div>' +
                    '</div>';
                }
                break;

            case 'text':
                for (var l = 0; l < count; l++) {
                    items += '<div class="skeleton-text skeleton-shimmer" style="width:' + (80 + Math.random() * 20) + '%"></div>';
                }
                break;

            default:
                items = '<div class="skeleton-text skeleton-shimmer"></div>';
        }

        return '<div class="skeleton-group">' + items + '</div>';
    }

    // ── Button Loading States ─────────────────────────────────

    /**
     * Set a button to loading state.
     * lsMicro.btnLoading(btn, 'Saving...')
     * Returns a restore function: restore() puts the button back.
     */
    function btnLoading(btn, loadingText) {
        if (!btn) return function () {};

        var originalHTML = btn.innerHTML;
        var originalDisabled = btn.disabled;

        var spinnerClass = 'ls-btn-spinner';
        // Use dark spinner for light/secondary buttons
        var bg = window.getComputedStyle(btn).backgroundColor;
        if (bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)' || bg.indexOf('246') > -1 || bg.indexOf('255, 255, 255') > -1) {
            spinnerClass = 'ls-btn-spinner ls-btn-spinner-dark';
        }

        btn.disabled = true;
        btn.classList.add('ls-btn-loading');
        btn.innerHTML = '<span class="' + spinnerClass + '"></span>' + (loadingText || 'Loading...');

        return function (successText) {
            btn.classList.remove('ls-btn-loading');
            if (successText) {
                btn.innerHTML = '✓ ' + successText;
                setTimeout(function () {
                    btn.innerHTML = originalHTML;
                    btn.disabled = originalDisabled;
                }, 1500);
            } else {
                btn.innerHTML = originalHTML;
                btn.disabled = originalDisabled;
            }
        };
    }

    // ── Empty States ───────────────────────────────────────────

    /** SVG icons for empty states */
    var EMPTY_ICONS = {
        calendar: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        chat: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
        file: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        users: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        search: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
        bell: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
        edit: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        inbox: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>'
    };

    /**
     * Generate a styled empty state HTML block.
     * lsMicro.emptyState({ icon: 'calendar', title: 'No events yet', message: '...', btnLabel: '...', btnAction: '...' })
     */
    function emptyState(opts) {
        opts = opts || {};
        var icon = EMPTY_ICONS[opts.icon] || EMPTY_ICONS.inbox;
        var title = opts.title || 'Nothing here yet';
        var message = opts.message || '';
        var compact = opts.compact || false;
        var btnHtml = '';
        if (opts.btnLabel) {
            btnHtml = '<button class="ls-empty-btn" onclick="' + (opts.btnAction || '') + '">' + opts.btnLabel + '</button>';
        }
        return '<div class="ls-empty-state' + (compact ? ' ls-empty-compact' : '') + '">' +
            '<div class="ls-empty-icon">' + icon + '</div>' +
            '<p class="ls-empty-title">' + title + '</p>' +
            (message ? '<p class="ls-empty-message">' + message + '</p>' : '') +
            btnHtml +
        '</div>';
    }

    // ── Network Error Banner ─────────────────────────────────

    var networkBanner = null;

    function showNetworkError(msg) {
        if (!networkBanner) {
            networkBanner = document.createElement('div');
            networkBanner.className = 'ls-network-banner';
            networkBanner.innerHTML =
                '<span class="ls-network-banner-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg></span>' +
                '<span class="ls-network-banner-text"></span>' +
                '<button class="ls-network-banner-dismiss" onclick="lsMicro.hideNetworkError()">&times;</button>';
            document.body.appendChild(networkBanner);
        }
        networkBanner.querySelector('.ls-network-banner-text').textContent = msg || 'Network error — please check your connection and try again.';
        requestAnimationFrame(function () {
            networkBanner.classList.add('visible');
        });
    }

    function hideNetworkError() {
        if (networkBanner) {
            networkBanner.classList.remove('visible');
        }
    }

    // ── Expose globally ───────────────────────────────────────
    window.lsMicro = {
        skeleton: skeleton,
        emptyState: emptyState,
        btnLoading: btnLoading,
        showNetworkError: showNetworkError,
        hideNetworkError: hideNetworkError
    };
})();

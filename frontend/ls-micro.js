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

    // ── Expose globally ───────────────────────────────────────
    window.lsMicro = {
        skeleton: skeleton,
        btnLoading: btnLoading
    };
})();

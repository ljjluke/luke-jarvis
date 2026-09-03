/**
 * ═══════════════════════════════════════════════════════════════
 *  Shared utilities for Ponder CLI scripts
 *  "工欲善其事，必先利其器" —《论语·卫灵公》
 * ═══════════════════════════════════════════════════════════════
 */

/**
 * Parse CLI args into key-value map — dashes kept as-is
 * --key value or --flag
 * Suitable for flags without dashes in names (mcts_tree.js)
 */
function parseArgsSimple(args) {
    const r = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const k = args[i].replace(/^--/, '');
            const v = args[i + 1];
            if (v && !v.startsWith('--')) { r[k] = v; i++; }
            else r[k] = true;
        }
    }
    return r;
}

/**
 * Parse CLI args into key-value map — dashes → underscores
 * --key-name value becomes { key_name: value }
 * Suitable for most compute/guard/template commands
 */
function parseArgs(args) {
    const r = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith("--")) {
            const k = args[i].replace(/^--/, "").replace(/-/g, "_");
            const v = args[i + 1];
            if (v && !v.startsWith("--")) { r[k] = v; i++; }
            else r[k] = true;
        }
    }
    return r;
}

module.exports = { parseArgs, parseArgsSimple };

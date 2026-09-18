<?php
/**
 * =========================================================================
 * Unraid Mobile Manager - Backend API (api.php)
 * Version: 2026.09.18.03
 * Release: 2026-09-18
 * =========================================================================
 */
define('UNRAID_API_VERSION', '2026.09.18.03');

@ob_start();
@ini_set('max_execution_time', '0');
@ini_set('max_input_time', '0');
@ini_set('memory_limit', '512M');
@ini_set('zlib.output_compression', 'Off');
@set_time_limit(0);
@ignore_user_abort(true);


/**
 * Unraid Mobile Manager - Unified Backend API (api.php)
 * 
 * Features:
 * 1. Single Token Authentication (URL parameter or HTTP Header)
 * 2. System Status & Hardware Telemetry (CPU, RAM, GPU, Disks, Network, Dockers, VMs)
 * 3. Power Control: Remote Reboot & Poweroff/Shutdown
 * 4. Docker & VM Management: Start, Stop, Restart
 * 5. S.M.A.R.T. Diagnostics
 * 6. High-Performance File Management:
 *    - Directory Browsing (JSON output, native UTF-8)
 *    - HTTP Range Streaming (RFC 7233 206 Partial Content for instant video/audio seeking)
 *    - File Read (with automatic UTF-8 transcoding for Chinese text) & Live Save
 *    - Multipart & Raw Binary File Upload
 *    - Make Directory, Rename, Delete, Move, Copy
 */

// Diagnostic logger with multi-path fallback (guaranteed writable in Unraid WebGUI)
function get_debug_log_path() {
    static $chosen = null;
    if ($chosen !== null) return $chosen;
    $candidates = [
        '/tmp/unraid_api_debug.log',
        '/var/local/emhttp/unraid_api_debug.log',
        dirname(__FILE__) . '/unraid_api_debug.log',
    ];
    foreach ($candidates as $p) {
        if (@file_exists($p)) {
            if (@is_writable($p)) {
                $chosen = $p;
                return $chosen;
            }
        } else {
            $d = dirname($p);
            if (@is_dir($d) && @is_writable($d)) {
                $chosen = $p;
                return $chosen;
            }
        }
    }
    $chosen = '/tmp/unraid_api_debug.log';
    return $chosen;
}

function log_upload_debug($msg) {
    $path = get_debug_log_path();
    $time = date('Y-m-d H:i:s');
    @file_put_contents($path, "[{$time}] {$msg}\n", FILE_APPEND);
}

// Log incoming request immediately before any exit or processing (skip noisy file_chunk to prevent disk thrashing)
$reqAction = isset($_GET['action']) ? $_GET['action'] : (isset($_POST['action']) ? $_POST['action'] : '');
if ($reqAction !== 'file_chunk') {
    $reqMethod = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'CLI';
    $reqUri = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
    $contentLen = isset($_SERVER['CONTENT_LENGTH']) ? $_SERVER['CONTENT_LENGTH'] : (isset($_SERVER['HTTP_CONTENT_LENGTH']) ? $_SERVER['HTTP_CONTENT_LENGTH'] : '0');
    log_upload_debug("REQ: {$reqMethod} {$reqUri} len={$contentLen}");
}

// Retrieve Unraid system CSRF token if available
function get_system_csrf_token() {
    static $token = null;
    if ($token !== null) return $token;

    $iniPaths = [
        '/var/local/emhttp/var.ini',
        '/var/run/emhttp/var.ini',
        '/var/run/emhttp.ini',
    ];
    foreach ($iniPaths as $p) {
        if (@file_exists($p)) {
            $content = @file_get_contents($p);
            if (!empty($content) && preg_match('/csrf_token="?([^"\r\n]+)"?/', $content, $m)) {
                $token = trim($m[1]);
                return $token;
            }
        }
    }

    if (!empty($GLOBALS['csrf_token'])) {
        $token = $GLOBALS['csrf_token'];
        return $token;
    }
    if (!empty($GLOBALS['var']['csrf_token'])) {
        $token = $GLOBALS['var']['csrf_token'];
        return $token;
    }

    return '';
}

// Enable CORS for mobile app
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Token, X-CSRF-Token, Range");
header("Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges");
header("Access-Control-Max-Age: 86400");

// Gracefully handle CORS preflight without dropping connection
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['status' => 'success', 'action' => 'options']);
    exit;
}

// Set error reporting and buffer output to ensure clean JSON responses
error_reporting(E_ALL);
@ini_set('display_errors', '0');

set_exception_handler(function($ex) {
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    log_upload_debug("UNCAUGHT EXCEPTION: " . $ex->getMessage() . " in " . basename($ex->getFile()) . ":" . $ex->getLine());
    echo json_encode([
        'status' => 'error',
        'message' => 'PHP Exception: ' . $ex->getMessage() . ' in ' . basename($ex->getFile()) . ':' . $ex->getLine()
    ], JSON_UNESCAPED_UNICODE);
    @flush();
    exit;
});

// Comprehensive shutdown handler: if script terminates prematurely or with fatal error, ALWAYS return JSON
register_shutdown_function(function() {
    if (!empty($GLOBALS['__api_response_sent'])) {
        return;
    }
    $err = error_get_last();
    if ($err !== null && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR])) {
        while (ob_get_level() > 0) {
            @ob_end_clean();
        }
        $msg = json_encode([
            'status' => 'error',
            'message' => 'PHP Fatal Error: ' . $err['message'] . ' in ' . basename($err['file']) . ':' . $err['line']
        ], JSON_UNESCAPED_UNICODE);
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
            }
        log_upload_debug("FATAL ERROR: " . $err['message'] . " in " . basename($err['file']) . ":" . $err['line']);
        echo $msg;
        @flush();
        exit;
    }

    // Guard against silent empty termination
    if (ob_get_length() === 0) {
        $msg = json_encode([
            'status' => 'error',
            'message' => 'PHP script terminated unexpectedly with empty output'
        ], JSON_UNESCAPED_UNICODE);
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
            }
        echo $msg;
        @flush();
    }
});

// Runtime performance and upload settings
@ini_set('upload_max_filesize', '10240M');
@ini_set('post_max_size', '10240M');
@ini_set('memory_limit', '1024M');
@ini_set('max_execution_time', '7200');
@ini_set('max_input_time', '7200');

// -------------------------------------------------------------
// Authentication Configuration
// -------------------------------------------------------------
define('FALLBACK_TOKEN', 'unraid2026');

function get_configured_token() {
    // 1. Check for unraid_api_token.txt in the same directory as api.php
    $sameDirFile = dirname(__FILE__) . '/unraid_api_token.txt';
    if (file_exists($sameDirFile)) {
        $content = trim((string)@file_get_contents($sameDirFile));
        if ($content !== '') {
            return $content;
        }
    }

    // 2. Also check standard Unraid plugin config location
    $pluginFile = '/boot/config/plugins/unraid_api_token.txt';
    if (file_exists($pluginFile)) {
        $content = trim((string)@file_get_contents($pluginFile));
        if ($content !== '') {
            return $content;
        }
    }

    // 3. Fallback to default token
    return FALLBACK_TOKEN;
}

function get_valid_tokens() {
    $token = get_configured_token();
    return [$token];
}

$actionParam = isset($_GET['action']) ? $_GET['action'] : (isset($_POST['action']) ? $_POST['action'] : '');
$rawGlobalInput = '';
if ($actionParam !== 'file_upload' && $actionParam !== 'file_chunk') {
    $rawGlobalInput = @file_get_contents('php://input');
}
$globalJsonInput = !empty($rawGlobalInput) ? @json_decode($rawGlobalInput, true) : null;

function verify_auth() {
    global $globalJsonInput;
    $reqToken = '';
    if (isset($_GET['token'])) {
        $reqToken = trim($_GET['token']);
    } elseif (isset($_POST['token'])) {
        $reqToken = trim($_POST['token']);
    } elseif (isset($globalJsonInput['token'])) {
        $reqToken = trim($globalJsonInput['token']);
    } elseif (isset($_SERVER['HTTP_X_API_TOKEN'])) {
        $reqToken = trim($_SERVER['HTTP_X_API_TOKEN']);
    } elseif (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        if (preg_match('/Bearer\s+(\S+)/i', $_SERVER['HTTP_AUTHORIZATION'], $m)) {
            $reqToken = trim($m[1]);
        }
    }

    $validTokens = get_valid_tokens();
    if (empty($reqToken) || !in_array($reqToken, $validTokens, true)) {
        // If accessed directly from a browser without token, show a friendly guide page instead of raw 401
        $accept = isset($_SERVER['HTTP_ACCEPT']) ? $_SERVER['HTTP_ACCEPT'] : '';
        if (strpos($accept, 'text/html') !== false && (empty($reqToken) || empty($_GET['action']))) {
            $GLOBALS['__api_response_sent'] = true;
            header('Content-Type: text/html; charset=utf-8');
            http_response_code(200);
            $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'IP:端口';
            echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unraid API 正常运行中</title><style>body{font-family:system-ui,sans-serif;background:#111827;color:#f3f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0} .card{background:#1f2937;padding:32px;border-radius:16px;max-width:520px;box-shadow:0 10px 25px rgba(0,0,0,0.5)} h1{color:#10b981;font-size:22px;margin-top:0} code{background:#374151;padding:2px 8px;border-radius:4px;color:#f59e0b} a{color:#3b82f6;text-decoration:none} a:hover{text-decoration:underline}</style></head><body>';
            echo '<div class="card"><h1>✅ Unraid API 服务运行正常！</h1>';
            echo '<p>您正在访问 Unraid Mobile Manager 后端 API 接口。</p>';
            $activeToken = get_configured_token();
            $isCustom = ($activeToken !== FALLBACK_TOKEN);
            $tokenSourceDesc = $isCustom ? '取自自定义 (unraid_api_token.txt)' : '取自系统默认';
            echo '<p>📱 <b>手机 App 连接配置：</b></p>';
            echo '<ul><li><b>服务器地址：</b> <code>http://' . htmlspecialchars($host) . '</code></li><li><b>API Token：</b> <code>已配置 · 已隐藏保护</code> <span style="color:#10b981">(' . $tokenSourceDesc . ')</span></li></ul>';
            echo '<p>⚙️ <b>API 版本：</b> <code>' . UNRAID_API_VERSION . '</code> <small style="color:#10b981">(与 Unraid 网页端实时同步)</small><br>📁 <b>当前文件：</b> <code>' . htmlspecialchars(__FILE__) . '</code></p>';
            echo '<p style="color:#9ca3af;font-size:13px;border-top:1px solid #374151;padding-top:12px;">🛡️ <b>安全保护：</b>为防止 Token 泄露，网页端不直接展示明文。请在手机 App 设置中填入您配置的 Token 进行连接。</p>';
            echo '</div></body></html>';
            exit;
        }

        $GLOBALS['__api_response_sent'] = true;
        header('Content-Type: application/json; charset=utf-8');
        http_response_code(401);
        echo json_encode([
            'status' => 'error',
            'message' => 'Unauthorized: Invalid or missing API Token.'
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

verify_auth();

@setlocale(LC_ALL, 'C.UTF-8', 'en_US.UTF-8', 'zh_CN.UTF-8');

$action = isset($_GET['action']) ? trim($_GET['action']) : (isset($_POST['action']) ? trim($_POST['action']) : (isset($globalJsonInput['action']) ? trim($globalJsonInput['action']) : 'status'));

// -------------------------------------------------------------
// Safe Path Normalization & Security Jail
// -------------------------------------------------------------
define('ALLOWED_ROOT', '/mnt');

/**
 * Safe multibyte-aware basename replacement (does not depend on system LC_ALL locale)
 */
function safe_basename($path) {
    $path = str_replace('\\', '/', trim((string)$path));
    $path = rtrim($path, '/');
    $pos = strrpos($path, '/');
    return ($pos === false) ? $path : substr($path, $pos + 1);
}

function sanitize_path($inputPath) {
    if (empty($inputPath) || $inputPath === '/' || $inputPath === '.') {
        return ALLOWED_ROOT;
    }
    // Handle double-URL-encoded paths (e.g. %2Fmnt%2Fuser...)
    if (stripos($inputPath, '%2f') !== false) {
        $inputPath = rawurldecode($inputPath);
    }
    $path = str_replace('\\', '/', trim((string)$inputPath));
    if (strpos($path, '/mnt') !== 0) {
        $path = rtrim(ALLOWED_ROOT, '/') . '/' . ltrim($path, '/');
    }
    $path = preg_replace('#/+#', '/', $path);
    $parts = explode('/', $path);
    $resolved = [];
    foreach ($parts as $p) {
        if ($p === '' || $p === '.') continue;
        if ($p === '..') {
            if (count($resolved) > 1) { // Never pop above root /mnt
                array_pop($resolved);
            }
        } else {
            $resolved[] = $p;
        }
    }
    $finalPath = '/' . implode('/', $resolved);
    if (strpos($finalPath, ALLOWED_ROOT) !== 0) {
        $finalPath = ALLOWED_ROOT;
    }
    return $finalPath;
}

function get_mime_type($filename) {
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    $mimes = [
        'mp4' => 'video/mp4', 'm4v' => 'video/mp4', 'mkv' => 'video/x-matroska',
        'webm' => 'video/webm', 'mov' => 'video/quicktime', 'avi' => 'video/x-msvideo',
        'ts' => 'video/mp2t', 'flv' => 'video/x-flv',
        'mp3' => 'audio/mpeg', 'wav' => 'audio/wav', 'ogg' => 'audio/ogg',
        'flac' => 'audio/flac', 'aac' => 'audio/aac', 'm4a' => 'audio/mp4',
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png',
        'gif' => 'image/gif', 'webp' => 'image/webp', 'bmp' => 'image/bmp', 'svg' => 'image/svg+xml',
        'pdf' => 'application/pdf', 'txt' => 'text/plain; charset=utf-8',
        'log' => 'text/plain; charset=utf-8', 'json' => 'application/json',
        'xml' => 'application/xml', 'html' => 'text/html; charset=utf-8',
        'css' => 'text/css', 'js' => 'application/javascript',
        'zip' => 'application/zip', 'tar' => 'application/x-tar',
        'epub' => 'application/epub+zip',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'doc' => 'application/msword',
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'xls' => 'application/vnd.ms-excel'
    ];
    return isset($mimes[$ext]) ? $mimes[$ext] : 'application/octet-stream';
}

// -------------------------------------------------------------
// ROUTER
// -------------------------------------------------------------
switch ($action) {
    case 'status':
        handle_status();
        break;

    case 'metrics_detail':
        handle_metrics_detail();
        break;

    case 'reboot':
        handle_reboot();
        break;

    case 'poweroff':
    case 'shutdown':
        handle_poweroff();
        break;

    case 'start_docker':
    case 'stop_docker':
    case 'restart_docker':
        handle_docker_action($action);
        break;

    case 'docker_logs':
        handle_docker_logs();
        break;

    case 'update_docker':
        handle_update_docker();
        break;

    case 'check_docker_updates':
        handle_check_docker_updates();
        break;

    case 'compose_list':
        handle_compose_list();
        break;

    case 'compose_action':
        handle_compose_action();
        break;

    case 'compose_file':
        handle_compose_file();
        break;

    case 'compose_save':
        handle_compose_save();
        break;

    case 'compose_logs':
        handle_compose_logs();
        break;

    case 'notifications':
        handle_notifications();
        break;

    case 'dismiss_notification':
        handle_dismiss_notification();
        break;

    case 'start_vm':
    case 'stop_vm':
    case 'restart_vm':
    case 'force_stop_vm':
    case 'pause_vm':
    case 'resume_vm':
        handle_vm_action($action);
        break;

    case 'parity_control':
        handle_parity_control();
        break;

    case 'syslog':
        handle_syslog();
        break;

    case 'smart_info':
        handle_smart_info();
        break;

    // --- File System Operations ---
    case 'file_list':
        handle_file_list();
        break;

    case 'download':
    case 'file_stream':
        handle_file_stream();
        break;

    case 'file_read':
        handle_file_read();
        break;

    case 'file_write':
        handle_file_write();
        break;

    case 'file_upload':
        handle_file_upload();
        break;

    case 'file_chunk':
        handle_file_chunk();
        break;

    case 'upload_debug':
        handle_upload_debug();
        break;

    case 'csrf_token':
        json_output([
            'status' => 'success',
            'csrf_token' => get_system_csrf_token()
        ]);
        break;

    case 'file_mkdir':
        handle_file_mkdir();
        break;

    case 'file_rename':
        handle_file_rename();
        break;

    case 'file_delete':
        handle_file_delete();
        break;

    case 'file_move':
        handle_file_move();
        break;

    case 'file_copy':
        handle_file_copy();
        break;

    case 'file_extract':
        handle_file_extract();
        break;

    case 'file_compress':
        handle_file_compress();
        break;

    case 'pdf_preview':
        handle_pdf_preview();
        break;

    case 'pdf_page':
        handle_pdf_page();
        break;

    case 'version':
        $parseIniBytes = function($val) {
            $val = trim((string)$val);
            if (empty($val)) return 0;
            $last = strtolower($val[strlen($val) - 1]);
            $num = floatval($val);
            switch ($last) {
                case 'g': $num *= 1024 * 1024 * 1024; break;
                case 'm': $num *= 1024 * 1024; break;
                case 'k': $num *= 1024; break;
            }
            return (int)$num;
        };

        $upMax = $parseIniBytes(ini_get('upload_max_filesize'));
        $postMax = $parseIniBytes(ini_get('post_max_size'));
        $singleLimit = ($upMax > 0 && $postMax > 0) ? min($upMax, $postMax) : ($upMax > 0 ? $upMax : ($postMax > 0 ? $postMax : 16777216));
        $safeDirectLimit = max(0, $singleLimit - 524288); // 512KB margin for multipart boundary and headers

        json_output([
            'status' => 'success',
            'api_version' => UNRAID_API_VERSION,
            'version' => UNRAID_API_VERSION,
            'max_upload_size' => $safeDirectLimit,
            'php_upload_max' => ini_get('upload_max_filesize'),
            'php_post_max' => ini_get('post_max_size'),
            'features' => ['docker_recreate', 'token_file', 'self_update', 'exact_update_sync', 'dynamic_upload_limit'],
            'file' => __FILE__
        ]);
        break;

    case 'self_update_api':
        handle_self_update_api();
        break;

    case 'update_api_file':
        handle_update_api_file();
        break;

    default:
        if (empty($action)) {
            json_output([
                'status' => 'success',
                'message' => 'Unraid Mobile Manager API 运行正常',
                'api_version' => UNRAID_API_VERSION,
                'version' => UNRAID_API_VERSION,
                'file' => __FILE__
            ]);
        } else {
            json_output(['status' => 'error', 'message' => "Unknown action: {$action}", 'api_version' => UNRAID_API_VERSION], 400);
        }
        break;
}

// -------------------------------------------------------------
// Safe Encoding & Scrubbing Helpers (Zero dependency on optional iconv extension)
// -------------------------------------------------------------
function safe_convert_encoding($str, $to = 'UTF-8', $from = ['GB18030', 'GBK', 'CP936', 'BIG5', 'EUC-CN', 'ISO-8859-1']) {
    if (!is_string($str) || $str === '') return $str;
    if (function_exists('mb_convert_encoding')) {
        $converted = @mb_convert_encoding($str, $to, $from);
        if ($converted !== false && strlen($converted) > 0) {
            return $converted;
        }
    }
    if (function_exists('iconv')) {
        $fromList = is_array($from) ? $from : [$from];
        foreach ($fromList as $enc) {
            $converted = @iconv($enc . '//IGNORE', $to, $str);
            if ($converted !== false && strlen($converted) > 0) {
                return $converted;
            }
        }
    }
    return $str;
}

function safe_scrub_utf8($str) {
    if (!is_string($str) || $str === '') return $str;
    if (function_exists('mb_scrub')) {
        return @mb_scrub($str, 'UTF-8');
    }
    if (function_exists('mb_convert_encoding')) {
        return @mb_convert_encoding($str, 'UTF-8', 'UTF-8');
    }
    if (function_exists('iconv')) {
        $res = @iconv('UTF-8', 'UTF-8//IGNORE', $str);
        if ($res !== false) return $res;
    }
    return $str;
}

// -------------------------------------------------------------
// Helper Output Function
// -------------------------------------------------------------
function json_output($data, $code = 200) {
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }

    // Recursively guarantee all string values are valid UTF-8 without throwing ValueError in PHP 8
    array_walk_recursive($data, function(&$val) {
        if (is_string($val)) {
            $val = safe_scrub_utf8($val);
            if (function_exists('mb_check_encoding') && !mb_check_encoding($val, 'UTF-8')) {
                $val = safe_convert_encoding($val, 'UTF-8', ['GB18030', 'GBK', 'BIG5', 'CP936', 'ISO-8859-1', 'UTF-8']);
                $val = safe_scrub_utf8($val);
            }
        }
    });

    $flags = JSON_UNESCAPED_UNICODE;
    if (defined('JSON_PARTIAL_OUTPUT_ON_ERROR')) {
        $flags |= JSON_PARTIAL_OUTPUT_ON_ERROR;
    }
    if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) {
        $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
    }

    $json = @json_encode($data, $flags);
    if ($json === false || $json === '' || $json === null) {
        $json = json_encode([
            'status' => 'error',
            'message' => 'JSON encoding failed: ' . json_last_error_msg()
        ]);
    }

    if (empty($json)) {
        $json = '{"status":"error","message":"Unknown JSON generation failure"}';
    }

    $GLOBALS['__api_response_sent'] = true;

    $len = strlen($json);
    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Length: ' . $len);
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Pragma: no-cache');
    }

    echo $json;

    // Fully flush all active output buffers before exit
    while (ob_get_level() > 0) {
        @ob_end_flush();
    }
    @flush();
    exit;
}

// -------------------------------------------------------------
// Power Controls
// -------------------------------------------------------------
function handle_reboot() {
    $cmd = "nohup sh -c 'sleep 1 && /sbin/reboot' > /dev/null 2>&1 &";
    exec($cmd);
    json_output([
        'status' => 'success',
        'message' => '服务器正在重启中，系统服务将在数分钟内重新上线。'
    ]);
}

function handle_poweroff() {
    $cmd = "nohup sh -c 'sleep 1 && /sbin/poweroff' > /dev/null 2>&1 &";
    exec($cmd);
    json_output([
        'status' => 'success',
        'message' => '服务器关机指令已生效，正在执行安全关机。'
    ]);
}

// -------------------------------------------------------------
// System Status & Telemetry
// -------------------------------------------------------------
function get_server_mac() {
    // 1. Try physical network interfaces first (eth0, br0, bond0, etc.)
    $candidateIfaces = ['eth0', 'br0', 'bond0', 'eth1', 'enp3s0', 'enp4s0', 'enp5s0', 'enp6s0'];
    foreach ($candidateIfaces as $iface) {
        $path = "/sys/class/net/{$iface}/address";
        if (file_exists($path)) {
            $mac = trim(@file_get_contents($path));
            if (!empty($mac) && $mac !== '00:00:00:00:00:00' && preg_match('/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/', $mac)) {
                return strtoupper($mac);
            }
        }
    }

    // 2. Scan all sysfs net interfaces (excluding virtual/docker/loopback/veth/virbr)
    $ifaces = @glob('/sys/class/net/*/address');
    if ($ifaces) {
        foreach ($ifaces as $addrFile) {
            $ifName = basename(dirname($addrFile));
            if ($ifName === 'lo' || strpos($ifName, 'docker') === 0 || strpos($ifName, 'veth') === 0 || strpos($ifName, 'virbr') === 0 || strpos($ifName, 'shim') === 0) {
                continue;
            }
            $mac = trim(@file_get_contents($addrFile));
            if (!empty($mac) && $mac !== '00:00:00:00:00:00' && preg_match('/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/', $mac)) {
                return strtoupper($mac);
            }
        }
    }

    // 3. Fallback via ip link / ifconfig
    $ipLink = @shell_exec('ip link show 2>/dev/null');
    if ($ipLink && preg_match('/link\/ether\s+([0-9a-fA-F:]{17})/i', $ipLink, $m)) {
        return strtoupper(trim($m[1]));
    }

    return '';
}


function get_docker_updates_map() {
    $dockerUpdatesMap = [];

    $register = function($key, $record) use (&$dockerUpdatesMap) {
        if (empty($key)) return;
        $clean = trim((string)$key, " \t\n\r\0\x0B/'\"[]()");
        if (empty($clean)) return;

        $variants = [
            $clean,
            strtolower($clean),
            ltrim($clean, '/'),
            strtolower(ltrim($clean, '/')),
        ];
        if (strpos($clean, 'my-') === 0) {
            $noMy = substr($clean, 3);
            $variants[] = $noMy;
            $variants[] = strtolower($noMy);
        }

        foreach ($variants as $v) {
            // Keep 'ready' if already marked ready
            if (isset($dockerUpdatesMap[$v]) && $dockerUpdatesMap[$v]['status'] === 'ready' && $record['status'] !== 'ready') {
                continue;
            }
            $dockerUpdatesMap[$v] = $record;
        }
    };

    // -------------------------------------------------------------
    // Source 1: Official Unraid Dynamix docker.json (Primary Storage)
    // -------------------------------------------------------------
    $jsonCandidates = [
        '/usr/local/emhttp/state/plugins/dynamix.docker.manager/docker.json',
        '/var/local/emhttp/plugins/dynamix.docker.manager/docker.json',
        '/var/local/emhttp/docker.json',
        '/tmp/docker.json'
    ];
    foreach ($jsonCandidates as $jf) {
        if (!file_exists($jf) || !is_readable($jf)) continue;
        $raw = @file_get_contents($jf);
        if (!$raw) continue;
        $arr = @json_decode($raw, true);
        if (!is_array($arr)) continue;

        foreach ($arr as $cName => $cInfo) {
            if (!is_array($cInfo)) continue;
            $upVal = isset($cInfo['updated']) ? strtolower(trim((string)$cInfo['updated'])) : '';
            // Unraid Dynamix: updated === 'false' means remote update available!
            // updated === 'true' means up to date
            // updated === 'ready' means local image pulled, container ready to recreate
            if ($upVal === 'false' || $upVal === '0') {
                $register($cName, ['has_update' => true, 'status' => 'update', 'status_text' => '更新']);
            } elseif ($upVal === 'ready') {
                $register($cName, ['has_update' => true, 'status' => 'ready', 'status_text' => '更新就绪']);
            } elseif ($upVal === 'true' || $upVal === '1') {
                $register($cName, ['has_update' => false, 'status' => 'up-to-date', 'status_text' => '最新']);
            }
        }
        break; // Successfully loaded official docker.json
    }

    // -------------------------------------------------------------
    // Source 2: Official Unraid unraid-update-status.json (Registry Digest Status)
    // -------------------------------------------------------------
    $statusFiles = [
        '/var/lib/docker/unraid-update-status.json',
        '/var/local/emhttp/plugins/dynamix.docker.manager/unraid-update-status.json'
    ];
    $imageUpdateStatus = [];
    foreach ($statusFiles as $sf) {
        if (!file_exists($sf) || !is_readable($sf)) continue;
        $raw = @file_get_contents($sf);
        if (!$raw) continue;
        $arr = @json_decode($raw, true);
        if (is_array($arr)) {
            $imageUpdateStatus = $arr;
            break;
        }
    }

    // -------------------------------------------------------------
    // Source 3: Docker Engine Containers & Local Image Inspect
    // -------------------------------------------------------------
    $inspectRaw = @shell_exec('docker inspect --format "{{.Name}}\t{{.Config.Image}}\t{{.Image}}\t{{.Id}}\t{{range .RepoDigests}}{{.}} {{end}}" $(docker ps -aq) 2>/dev/null');
    if (!empty($inspectRaw)) {
        $imagesRaw = @shell_exec('docker images --no-trunc --format "{{.Repository}}:{{.Tag}}\t{{.ID}}" 2>/dev/null');
        $tagToId = [];
        if (!empty($imagesRaw)) {
            foreach (explode("\n", trim($imagesRaw)) as $imgLine) {
                $parts = explode("\t", trim($imgLine));
                if (count($parts) >= 2) {
                    $tagToId[trim($parts[0])] = preg_replace('/^sha256:/', '', trim($parts[1]));
                }
            }
        }

        foreach (explode("\n", trim($inspectRaw)) as $cLine) {
            $parts = explode("\t", trim($cLine));
            if (count($parts) >= 3) {
                $cName = ltrim(trim($parts[0]), '/');
                $cImageTag = trim($parts[1]);
                $cRunningId = preg_replace('/^sha256:/', '', trim($parts[2]));
                $cFullId = isset($parts[3]) ? trim($parts[3]) : '';
                $repoDigestsStr = isset($parts[4]) ? trim($parts[4]) : '';

                // Extract local repo digest if present
                $localDigest = '';
                if (!empty($repoDigestsStr)) {
                    $digests = explode(' ', $repoDigestsStr);
                    foreach ($digests as $d) {
                        $d = trim($d);
                        if (strpos($d, '@sha256:') !== false) {
                            $localDigest = substr($d, strpos($d, '@sha256:') + 1);
                            break;
                        }
                    }
                }

                // Check status from unraid-update-status.json
                $remoteDigest = '';
                $stStatus = '';
                if (!empty($imageUpdateStatus) && !empty($cImageTag)) {
                    $lookupImg = $cImageTag;
                    if (strpos($lookupImg, ':') === false) $lookupImg .= ':latest';
                    if (isset($imageUpdateStatus[$lookupImg])) {
                        $st = $imageUpdateStatus[$lookupImg];
                        $stStatus = strtolower(trim((string)($st['status'] ?? '')));
                        $remoteDigest = trim((string)($st['remote'] ?? ''));
                        if (empty($localDigest) && !empty($st['local'])) {
                            $localDigest = trim((string)$st['local']);
                        }
                    }
                }

                // A. Check for "ready" state: local image pulled with different ID than running container
                $localImgId = $tagToId[$cImageTag] ?? '';
                if (!empty($localImgId) && !empty($cRunningId) && $localImgId !== $cRunningId) {
                    $rec = [
                        'has_update' => true,
                        'status' => 'ready',
                        'status_text' => '更新就绪',
                        'local_digest' => $localDigest,
                        'remote_digest' => $remoteDigest,
                        'running_image_id' => $cRunningId,
                        'latest_image_id' => $localImgId,
                    ];
                    $register($cName, $rec);
                    if (!empty($cFullId)) {
                        $dockerUpdatesMap[substr($cFullId, 0, 12)] = $rec;
                        $dockerUpdatesMap[$cFullId] = $rec;
                    }
                    continue;
                }

                // B. If not already marked from docker.json, check unraid-update-status.json
                if (!empty($imageUpdateStatus) && !empty($cImageTag) && !isset($dockerUpdatesMap[$cName])) {
                    $hasRemDiff = (!empty($remoteDigest) && !empty($localDigest) && $remoteDigest !== $localDigest);
                    if ($stStatus === 'false' || $hasRemDiff) {
                        $rec = [
                            'has_update' => true,
                            'status' => 'update',
                            'status_text' => '更新',
                            'local_digest' => $localDigest,
                            'remote_digest' => $remoteDigest,
                            'running_image_id' => $cRunningId,
                            'latest_image_id' => $localImgId,
                        ];
                        $register($cName, $rec);
                        if (!empty($cFullId)) {
                            $dockerUpdatesMap[substr($cFullId, 0, 12)] = $rec;
                            $dockerUpdatesMap[$cFullId] = $rec;
                        }
                    } elseif ($stStatus === 'true' && !$hasRemDiff) {
                        $rec = [
                            'has_update' => false,
                            'status' => 'up-to-date',
                            'status_text' => '最新',
                            'local_digest' => $localDigest,
                            'remote_digest' => $remoteDigest,
                            'running_image_id' => $cRunningId,
                            'latest_image_id' => $localImgId,
                        ];
                        $register($cName, $rec);
                        if (!empty($cFullId)) {
                            $dockerUpdatesMap[substr($cFullId, 0, 12)] = $rec;
                            $dockerUpdatesMap[$cFullId] = $rec;
                        }
                    }
                } elseif (isset($dockerUpdatesMap[$cName])) {
                    // Enrich existing record with digest details
                    $dockerUpdatesMap[$cName]['local_digest'] = $localDigest;
                    $dockerUpdatesMap[$cName]['remote_digest'] = $remoteDigest;
                    $dockerUpdatesMap[$cName]['running_image_id'] = $cRunningId;
                    $dockerUpdatesMap[$cName]['latest_image_id'] = $localImgId;
                }
            }
        }
    }

    // -------------------------------------------------------------
    // Source 4: Legacy docker.ini fallback (if present in custom setups)
    // -------------------------------------------------------------
    $iniFile = '/var/local/emhttp/docker.ini';
    if (file_exists($iniFile) && is_readable($iniFile)) {
        $parsed = @parse_ini_file($iniFile, true);
        if (is_array($parsed)) {
            foreach ($parsed as $secName => $sec) {
                if (!is_array($sec)) continue;
                if (isset($dockerUpdatesMap[$secName])) continue;
                $rawUpdated = strtolower(trim((string)($sec['updated'] ?? ($sec['Updated'] ?? ''))));
                if ($rawUpdated === 'ready') {
                    $register($secName, ['has_update' => true, 'status' => 'ready', 'status_text' => '更新就绪']);
                } elseif ($rawUpdated === 'false') {
                    $register($secName, ['has_update' => true, 'status' => 'update', 'status_text' => '更新']);
                } elseif ($rawUpdated === 'true') {
                    $register($secName, ['has_update' => false, 'status' => 'up-to-date', 'status_text' => '最新']);
                }
            }
        }
    }

    return $dockerUpdatesMap;
}



function handle_status() {
    // 1. CPU Usage
    $cpuUsage = 0;
    $stat1 = @file('/proc/stat');
    if ($stat1) {
        $info1 = explode(" ", preg_replace("/\s+/", " ", trim($stat1[0])));
        usleep(100000); // 100ms
        $stat2 = @file('/proc/stat');
        $info2 = explode(" ", preg_replace("/\s+/", " ", trim($stat2[0])));
        $dif = [];
        $dif['user'] = $info2[1] - $info1[1];
        $dif['nice'] = $info2[2] - $info1[2];
        $dif['sys'] = $info2[3] - $info1[3];
        $dif['idle'] = $info2[4] - $info1[4];
        $total = array_sum($dif);
        if ($total > 0) {
            $cpuUsage = round(100 * ($total - $dif['idle']) / $total, 1);
        }
    }

    // 2. Memory Usage
    $memUsage = 0;
    $memTotalBytes = 0;
    $memAvailBytes = 0;
    $memUsedBytes = 0;
    $meminfo = @file_get_contents('/proc/meminfo');
    if ($meminfo) {
        preg_match('/MemTotal:\s+(\d+)\s+kB/', $meminfo, $totalMatches);
        preg_match('/MemAvailable:\s+(\d+)\s+kB/', $meminfo, $availMatches);
        preg_match('/MemFree:\s+(\d+)\s+kB/', $meminfo, $freeMatches);
        preg_match('/Buffers:\s+(\d+)\s+kB/', $meminfo, $bufMatches);
        preg_match('/^Cached:\s+(\d+)\s+kB/m', $meminfo, $cacheMatches);

        $totalKb = isset($totalMatches[1]) ? (float)$totalMatches[1] : 0;
        $availKb = isset($availMatches[1]) ? (float)$availMatches[1] : 0;
        if ($availKb === 0.0 && isset($freeMatches[1])) {
            $freeKb = (float)$freeMatches[1];
            $bufKb = isset($bufMatches[1]) ? (float)$bufMatches[1] : 0;
            $cacheKb = isset($cacheMatches[1]) ? (float)$cacheMatches[1] : 0;
            $availKb = $freeKb + $bufKb + $cacheKb;
        }

        if ($totalKb > 0) {
            $memTotalBytes = $totalKb * 1024;
            $memAvailBytes = $availKb * 1024;
            $memUsedBytes = max(0, $memTotalBytes - $memAvailBytes);
            $memUsage = round(($memUsedBytes / $memTotalBytes) * 100, 1);
        }
    }

        // 3. Comprehensive GPU Telemetry (NVIDIA, Intel iGPU, AMD, gpustat)
    $gpuData = get_gpu_telemetry();
    $diskIoMap = get_disk_io_stats();
    $totalArrayReadBytes = 0;
    $totalArrayWriteBytes = 0;

    // 4. Storage & Disks
    $disks = [];
    $seen = [];
    $totalArraySize = 0;
    $totalArrayUsed = 0;

    // Load native Unraid disks.ini for accurate physical devices & temps
    $unraidDisks = [];
    $iniFile = '/var/local/emhttp/disks.ini';
    if (file_exists($iniFile)) {
        $ini = @parse_ini_file($iniFile, true);
        if ($ini) {
            foreach ($ini as $sec => $d) {
                if (!empty($d['name'])) {
                    $unraidDisks[$d['name']] = $d;
                }
                $unraidDisks[$sec] = $d;
                if (!empty($d['device'])) {
                    $unraidDisks[$d['device']] = $d;
                }
            }
        }
    }

    // 1. Add Parity drives from disks.ini (Unraid displays parity at top)
    if (!empty($unraidDisks)) {
        foreach ($unraidDisks as $sec => $d) {
            $dType = isset($d['type']) ? $d['type'] : '';
            $dName = isset($d['name']) ? $d['name'] : $sec;
            if (stripos($dType, 'Parity') !== false || stripos($dName, 'parity') === 0) {
                if (!isset($seen[$dName]) && !empty($d['device'])) {
                    $seen[$dName] = true;
                    $size = isset($d['size']) ? ((float)$d['size'] * 1024) : 0;
                    $temp = (isset($d['temp']) && is_numeric($d['temp'])) ? (int)$d['temp'] : null;
                    $isSpunDown = (isset($d['spundown']) && $d['spundown'] == 1);
                    $smartStatus = (!empty($d['status']) && stripos($d['status'], 'OK') !== false) ? 'Normal' : 'Error';
                    $devName = !empty($d['device']) ? $d['device'] : '';
                    $devIo = isset($diskIoMap[$devName]) ? $diskIoMap[$devName] : null;
                    $rB = $devIo ? $devIo['read_bytes'] : 0;
                    $wB = $devIo ? $devIo['write_bytes'] : 0;
                    $totalArrayReadBytes += $rB;
                    $totalArrayWriteBytes += $wB;
$disks[] = [
                        'name' => $dName,
                        'device' => $d['device'],
                        'size' => $size,
                        'total' => $size,
                        'used' => $size,
                        'percentage' => 100,
                        'temp' => $temp,
                        'status' => $isSpunDown ? 'standby' : 'active',
                        'smart_status' => $smartStatus,
                        'num_errors' => isset($d['numErrors']) ? (int)$d['numErrors'] : 0,
                        'fs_type' => isset($d['fsType']) ? $d['fsType'] : '',
                        'free' => 0,
                        'is_parity' => true,
                        'read_bytes' => $rB,
                        'write_bytes' => $wB
                    ];
                }
            }
        }
    }

    // 2. Add Data & Cache drives from df
    $dfOutput = @shell_exec('df -B1 /mnt/disk* /mnt/cache* /mnt/pool* /mnt/fast* /mnt/user 2>/dev/null');
    if ($dfOutput) {
        $lines = explode("\n", trim($dfOutput));
        array_shift($lines); // header
        foreach ($lines as $line) {
            $parts = preg_split('/\s+/', trim($line));
            if (count($parts) >= 6) {
                $mount = $parts[5];
                $name = safe_basename($mount);

                if ($mount === '/mnt/user') {
                    $totalArraySize = (float)$parts[1];
                    $totalArrayUsed = (float)$parts[2];
                    continue;
                }
                if (!isset($seen[$name])) {
                    $seen[$name] = true;
                    $size = (float)$parts[1];
                    $used = (float)$parts[2];
                    $pct = ($size > 0) ? round(($used / $size) * 100, 1) : 0;

                    // Prefer true physical device from disks.ini (e.g. sdb, nvme0n1 instead of md1)
                    $uInfo = isset($unraidDisks[$name]) ? $unraidDisks[$name] : null;
                    $dev = ($uInfo && !empty($uInfo['device'])) ? $uInfo['device'] : safe_basename($parts[0]);

                    // Temperature from disks.ini if present
                    $temp = ($uInfo && isset($uInfo['temp']) && is_numeric($uInfo['temp'])) ? (int)$uInfo['temp'] : null;

                    // Standby / Spundown status
                    $isSpunDown = ($uInfo && isset($uInfo['spundown']) && $uInfo['spundown'] == 1);
                    if ($isSpunDown) {
                        $status = 'standby';
                    } else {
                        $standbyCheck = @shell_exec("hdparm -C /dev/{$dev} 2>/dev/null");
                        $status = (strpos($standbyCheck, 'standby') !== false) ? 'standby' : 'active';
                    }

                    $smartStatus = ($uInfo && !empty($uInfo['status'])) ? $uInfo['status'] : 'Normal';
                    if (stripos($smartStatus, 'ERROR') !== false || stripos($smartStatus, 'FAIL') !== false) {
                        $smartStatus = 'Error';
                    } else {
                        $smartStatus = 'Normal';
                    }

                    $devIo = !empty($dev) && isset($diskIoMap[$dev]) ? $diskIoMap[$dev] : null;
                    $rB = $devIo ? $devIo['read_bytes'] : 0;
                    $wB = $devIo ? $devIo['write_bytes'] : 0;
                    $totalArrayReadBytes += $rB;
                    $totalArrayWriteBytes += $wB;
$disks[] = [
                        'name' => $name,
                        'device' => $dev,
                        'mount' => $mount,
                        'size' => $size,
                        'total' => $size,
                        'used' => $used,
                        'free' => max(0, $size - $used),
                        'percentage' => $pct,
                        'temp' => $temp,
                        'status' => $status,
                        'smart_status' => $smartStatus,
                        'num_errors' => ($uInfo && isset($uInfo['numErrors'])) ? (int)$uInfo['numErrors'] : 0,
                        'fs_type' => ($uInfo && isset($uInfo['fsType'])) ? $uInfo['fsType'] : '',
                        'is_parity' => false,
                        'read_bytes' => $rB,
                        'write_bytes' => $wB
                    ];
                }
            }
        }
    }

    $storagePercentage = ($totalArraySize > 0) ? round(($totalArrayUsed / $totalArraySize) * 100, 1) : 0;

    // 5. Docker Containers (with live CPU and Memory from docker stats)
    $dockersList = [];
    $statsMap = [];
    
    // Fast non-blocking cached docker stats
    $cacheFile = '/tmp/unraid_docker_stats_cache.txt';
    $cacheTmp = '/tmp/unraid_docker_stats_cache.tmp';
    $now = time();
    $cacheAge = file_exists($cacheFile) ? ($now - filemtime($cacheFile)) : 999;
    
    // If cache is older than 4s or missing, trigger a refresh
    if ($cacheAge > 4) {
        $refreshCmd = "nohup sh -c 'docker stats --no-stream --format \"{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.ID}}\" 2>/dev/null > {$cacheTmp} && mv {$cacheTmp} {$cacheFile}' >/dev/null 2>&1 &";
        @exec($refreshCmd);
        // If cache doesn't exist at all yet (first run), run sync with 5s timeout
        if (!file_exists($cacheFile)) {
            $syncStats = @shell_exec('timeout 5 docker stats --no-stream --format "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.ID}}" 2>/dev/null');
            if ($syncStats) {
                @file_put_contents($cacheFile, $syncStats);
            }
        }
    }

    $dockerStats = file_exists($cacheFile) ? @file_get_contents($cacheFile) : '';
    if ($dockerStats) {
        // Strip any ANSI terminal escape codes
        $dockerStats = preg_replace('/\x1b\[[0-9;]*[a-zA-Z]/', '', $dockerStats);
        foreach (explode("\n", trim($dockerStats)) as $sLine) {
            $sCols = explode("\t", trim($sLine));
            if (count($sCols) >= 3 && !empty($sCols[0])) {
                $rawName = trim($sCols[0]);
                $rawCpu = trim($sCols[1]);
                $rawMem = trim($sCols[2]);
                $sData = [
                    'cpu' => $rawCpu,
                    'memory' => $rawMem
                ];
                $statsMap[$rawName] = $sData;
                $statsMap[ltrim($rawName, '/')] = $sData;
                if (isset($sCols[3]) && !empty($sCols[3])) {
                    $statsMap[trim($sCols[3])] = $sData;
                }
            }
        }
    }

    // 12-hour background silent update check
    $lastCheckFile = '/tmp/unraid_last_docker_update_check.txt';
    $lastCheckTime = file_exists($lastCheckFile) ? (int)@file_get_contents($lastCheckFile) : 0;
    if ((time() - $lastCheckTime) > 43200) { // 12 hours
        @file_put_contents($lastCheckFile, time());
        $upScript = '/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate';
        if (file_exists($upScript)) {
            @exec("nohup {$upScript} check >/dev/null 2>&1 &");
        }
    }

    $dockerUpdatesMap = get_docker_updates_map();
    
    $serverHost = !empty($_SERVER['HTTP_HOST']) ? preg_replace('/:.*$/', '', $_SERVER['HTTP_HOST']) : '192.168.1.1';
    $dockerPs = @shell_exec('docker ps -a --format "{{.Names}}\t{{.Status}}\t{{.ID}}\t{{.Ports}}\t{{.Image}}" 2>/dev/null');
    if ($dockerPs) {
        $lines = explode("\n", trim($dockerPs));
        foreach ($lines as $line) {
            $cols = explode("\t", $line);
            if (count($cols) >= 2 && !empty($cols[0])) {
                $cName = trim($cols[0]);
                $cleanName = ltrim($cName, '/');
                $cId = isset($cols[2]) ? trim($cols[2]) : '';
                $cPortsRaw = isset($cols[3]) ? trim($cols[3]) : '';
                $cImage = isset($cols[4]) ? trim($cols[4]) : '';
                $cStatus = (strpos($cols[1], 'Up') === 0) ? 'running' : 'stopped';
                
                // Parse primary web port & WebUI URL
                $primaryPort = '';
                $webuiUrl = '';
                if (!empty($cPortsRaw)) {
                    if (preg_match('/(?:0\.0\.0\.0|:::|\[::\])?:?(\d+)->(\d+)\/tcp/', $cPortsRaw, $pm)) {
                        $primaryPort = $pm[1];
                        $webuiUrl = "http://{$serverHost}:{$primaryPort}";
                    }
                }

                $cStats = null;
                if (isset($statsMap[$cName])) {
                    $cStats = $statsMap[$cName];
                } elseif (isset($statsMap[$cleanName])) {
                    $cStats = $statsMap[$cleanName];
                } elseif (!empty($cId) && isset($statsMap[$cId])) {
                    $cStats = $statsMap[$cId];
                }

                $cpuStr = ($cStatus === 'running' && $cStats) ? $cStats['cpu'] : '0.0%';
                $memStr = ($cStatus === 'running' && $cStats) ? $cStats['memory'] : '0B';
                $info = null;
                $candidates = [
                    $cleanName,
                    strtolower($cleanName),
                    $cName,
                    strtolower($cName),
                ];
                if (strpos($cleanName, 'my-') === 0) {
                    $candidates[] = substr($cleanName, 3);
                    $candidates[] = strtolower(substr($cleanName, 3));
                }
                if (!empty($cId)) {
                    $candidates[] = substr($cId, 0, 12);
                    $candidates[] = $cId;
                }
                foreach ($candidates as $cand) {
                    if (isset($dockerUpdatesMap[$cand])) {
                        $info = $dockerUpdatesMap[$cand];
                        break;
                    }
                }

                $hasUpdate = !empty($info['has_update']);
                $updateStatus = !empty($info['status']) ? $info['status'] : 'up-to-date';
                $updateStatusText = !empty($info['status_text']) ? $info['status_text'] : '最新';

                $dockersList[] = [
                    'name' => $cleanName,
                    'status' => $cStatus,
                    'cpu' => $cpuStr,
                    'memory' => $memStr,
                    'mem' => $memStr,
                    'ports' => $cPortsRaw,
                    'port' => $primaryPort,
                    'webui' => $webuiUrl,
                    'update_available' => $hasUpdate,
                    'update_status' => $updateStatus,
                    'update_status_text' => $updateStatusText,
                    'image' => $cImage,
                    'image_id' => !empty($info['running_image_id']) ? $info['running_image_id'] : '',
                    'local_digest' => !empty($info['local_digest']) ? $info['local_digest'] : '',
                    'remote_digest' => !empty($info['remote_digest']) ? $info['remote_digest'] : '',
                ];
            }
        }
    }
    $runningDockers = count(array_filter($dockersList, function($d) { return $d['status'] === 'running'; }));

    // 6. Virtual Machines (virsh)
    $vmsList = [];
    $virshOutput = @shell_exec('virsh list --all 2>/dev/null');
    if ($virshOutput) {
        $lines = explode("\n", trim($virshOutput));
        if (count($lines) >= 3) {
            array_shift($lines);
            array_shift($lines);
            foreach ($lines as $line) {
                $cols = preg_split('/\s+/', trim($line));
                if (count($cols) >= 3) {
                    $vName = $cols[1];
                    $vState = ($cols[2] === 'running') ? 'running' : ($cols[2] === 'paused' ? 'paused' : 'shut off');
                    $vmsList[] = [
                        'name' => $vName,
                        'status' => $vState,
                        'cores' => 2,
                        'memory' => 4 * 1024 * 1024 * 1024
                    ];
                }
            }
        }
    }
    $runningVms = count(array_filter($vmsList, function($v) { return $v['status'] === 'running'; }));

    // 7. Network rx/tx bytes & differential speed
    $netRx = 0;
    $netTx = 0;
    $netLines = @file('/proc/net/dev');
    if ($netLines) {
        foreach ($netLines as $nLine) {
            if (strpos($nLine, ':') !== false) {
                $parts = explode(':', $nLine);
                $iface = trim($parts[0]);
                if ($iface === 'eth0' || $iface === 'br0' || $iface === 'bond0') {
                    $vals = preg_split('/\s+/', trim($parts[1]));
                    $netRx += (float)$vals[0];
                    $netTx += (float)$vals[8];
                    break;
                }
            }
        }
    }

    $rxBps = 0;
    $txBps = 0;
    $netRateFile = '/tmp/unraid_net_rate.json';
    $nowFloat = microtime(true);
    if (file_exists($netRateFile)) {
        $lastNet = @json_decode(@file_get_contents($netRateFile), true);
        if (is_array($lastNet) && isset($lastNet['t']) && isset($lastNet['rx']) && isset($lastNet['tx'])) {
            $dt = $nowFloat - (float)$lastNet['t'];
            if ($dt > 0.2 && $dt < 60.0) {
                $rxDiff = $netRx - (float)$lastNet['rx'];
                $txDiff = $netTx - (float)$lastNet['tx'];
                if ($rxDiff >= 0) $rxBps = round($rxDiff / $dt);
                if ($txDiff >= 0) $txBps = round($txDiff / $dt);
            }
        }
    }
    @file_put_contents($netRateFile, json_encode(['t' => $nowFloat, 'rx' => $netRx, 'tx' => $netTx]), LOCK_EX);

    // Update 5-minute rolling metrics history
    $metricsHistory = update_metrics_history($cpuUsage, $memUsage, isset($gpuData['usage']) ? $gpuData['usage'] : 0, $rxBps, $txBps);

    // 8. Array Parity Check Telemetry (var.ini & /proc/mdstat)
    $parityData = [
        'status' => 'idle',
        'progress' => 0,
        'speed' => '',
        'errors' => 0,
        'finish' => '',
        'action' => '空闲',
        'is_checking' => false
    ];

    $varIniPath = '/var/local/emhttp/var.ini';
    $emhttpVars = [];
    if (file_exists($varIniPath)) {
        $emhttpVars = @parse_ini_file($varIniPath);
    }

    if (!empty($emhttpVars)) {
        $mdResync = isset($emhttpVars['mdResync']) ? (string)$emhttpVars['mdResync'] : '0';
        $mdResyncPct = isset($emhttpVars['mdResyncPct']) ? (float)$emhttpVars['mdResyncPct'] : 0;
        $mdResyncSpeed = isset($emhttpVars['mdResyncSpeed']) ? (string)$emhttpVars['mdResyncSpeed'] : '';
        $mdResyncErrors = isset($emhttpVars['mdResyncErrors']) ? (int)$emhttpVars['mdResyncErrors'] : 0;
        $mdResyncFinish = isset($emhttpVars['mdResyncFinish']) ? (string)$emhttpVars['mdResyncFinish'] : '';
        $mdResyncAction = isset($emhttpVars['mdResyncAction']) ? (string)$emhttpVars['mdResyncAction'] : 'Parity-Check';

        if ($mdResync === '1' || $mdResyncPct > 0) {
            $isPaused = (stripos($mdResyncAction, 'pause') !== false || ($mdResyncSpeed === '0' || $mdResyncSpeed === '0.0'));
            $parityData['status'] = $isPaused ? 'paused' : 'checking';
            $parityData['is_checking'] = true;
            $parityData['progress'] = $mdResyncPct;
            $parityData['speed'] = $mdResyncSpeed ? (is_numeric($mdResyncSpeed) ? round((float)$mdResyncSpeed / 1024, 1) . ' MB/s' : $mdResyncSpeed) : '';
            $parityData['errors'] = $mdResyncErrors;
            $parityData['finish'] = $mdResyncFinish ? $mdResyncFinish : '';
            $parityData['action'] = $mdResyncAction;
        }
    }

    // Fallback checking via /proc/mdstat if var.ini not reporting resync
    if (!$parityData['is_checking'] && file_exists('/proc/mdstat')) {
        $mdstat = @file_get_contents('/proc/mdstat');
        if ($mdstat && preg_match('/resync\s*=\s*([0-9\.]+)%.*?speed=([0-9\.]+)\s*(?:K\/sec|KB\/s)?/i', $mdstat, $pm)) {
            $parityData['status'] = 'checking';
            $parityData['is_checking'] = true;
            $parityData['progress'] = (float)$pm[1];
            $speedKb = (float)$pm[2];
            $parityData['speed'] = round($speedKb / 1024, 1) . ' MB/s';
            if (preg_match('/finish=([0-9\.]+)min/i', $mdstat, $fm)) {
                $finishMin = (float)$fm[1];
                if ($finishMin > 60) {
                    $hours = floor($finishMin / 60);
                    $mins = round($finishMin % 60);
                    $parityData['finish'] = "约 {$hours} 小时 {$mins} 分钟";
                } else {
                    $parityData['finish'] = "约 " . round($finishMin) . " 分钟";
                }
            }
        }
    }

    // 8. Hostname, Uptime and CPU temperature
    $hostname = @gethostname() ?: 'Unraid Server';
    $uptimeStr = '';
    $upSecs = @file_get_contents('/proc/uptime');
    if ($upSecs) {
        $sec = (int)explode(' ', trim($upSecs))[0];
        $days = floor($sec / 86400);
        $hours = floor(($sec % 86400) / 3600);
        $uptimeStr = $days > 0 ? "已开机 {$days}天 {$hours}小时" : "已开机 {$hours}小时";
    }

    $cpuTemp = null;
    $zones = @glob('/sys/class/thermal/thermal_zone*/temp');
    if ($zones) {
        foreach ($zones as $z) {
            $t = (int)trim(@file_get_contents($z));
            if ($t > 1000) $t = round($t / 1000);
            if ($t >= 20 && $t <= 110) {
                $cpuTemp = $t;
                break;
            }
        }
    }

    json_output([
        'api_version' => UNRAID_API_VERSION,
        'api_features' => ['docker_recreate', 'token_file', 'self_update'],
        'api_file' => __FILE__,
        'stats' => [
            'cpu' => $cpuUsage,
            'memory' => $memUsage,
            'mem_total' => $memTotalBytes,
            'mem_used' => $memUsedBytes,
            'mem_avail' => $memAvailBytes,
            'cpu_temp' => $cpuTemp,
            'uptime' => $uptimeStr,
            'hostname' => $hostname
        ],
        'gpu' => $gpuData,
        'storage' => [
            'percentage' => $storagePercentage,
            'total_used' => $totalArrayUsed,
            'total_size' => $totalArraySize,
            'total_read_bytes' => $totalArrayReadBytes,
            'total_write_bytes' => $totalArrayWriteBytes,
            'disks' => $disks
        ],
        'dockers' => [
            'running' => $runningDockers,
            'total' => count($dockersList),
            'list' => $dockersList
        ],
        'vms' => [
            'running' => $runningVms,
            'total' => count($vmsList),
            'list' => $vmsList
        ],
        'network' => [
            'rx_bytes' => $netRx,
            'tx_bytes' => $netTx,
            'rx_bps' => $rxBps,
            'tx_bps' => $txBps,
            'mac' => get_server_mac()
        ],
        'history' => $metricsHistory,
        'parity' => $parityData,
        'csrf_token' => get_system_csrf_token()
    ]);
}

// -------------------------------------------------------------
// Docker & VM Controls
// -------------------------------------------------------------
function handle_docker_action($action) {
    $target = isset($_GET['target']) ? escapeshellarg($_GET['target']) : '';
    if (empty($target)) {
        json_output(['status' => 'error', 'message' => 'Missing target docker container'], 400);
    }
    $cmd = '';
    if ($action === 'start_docker') $cmd = "docker start {$target}";
    elseif ($action === 'stop_docker') $cmd = "docker stop {$target}";
    elseif ($action === 'restart_docker') $cmd = "docker restart {$target}";
    
    $out = shell_exec($cmd . ' 2>&1');
    json_output(['status' => 'success', 'message' => "Docker action {$action} executed", 'ready_count' => $readyCount,
        'new_version_count' => $newVersionCount,
        'output' => trim($out)
    ]);
}

function handle_docker_logs() {
    $target = isset($_GET['target']) ? trim($_GET['target']) : (isset($_GET['name']) ? trim($_GET['name']) : '');
    if (empty($target)) {
        json_output(['status' => 'error', 'message' => 'Missing container name'], 400);
    }
    $lines = isset($_GET['lines']) ? (int)$_GET['lines'] : 150;
    if ($lines <= 0 || $lines > 1000) $lines = 150;

    $escaped = escapeshellarg($target);
    $out = @shell_exec("docker logs --tail {$lines} --timestamps {$escaped} 2>&1");
    if ($out === null || $out === false) {
        $out = "未能读取到容器 [{$target}] 的日志。";
    }

    json_output([
        'status' => 'success',
        'name' => $target,
        'lines' => $lines,
        'logs' => $out
    ]);
}

// -------------------------------------------------------------
// Docker Container Update / Upgrade
// -------------------------------------------------------------
function handle_update_docker() {
    @set_time_limit(600);
    @ini_set('max_execution_time', '600');
    @ignore_user_abort(true);

    $target = isset($_GET['target']) ? trim($_GET['target']) : '';
    if (empty($target)) {
        json_output(['status' => 'error', 'message' => '缺少目标容器名称参数']);
        return;
    }
    
    $cleanTarget = ltrim($target, '/');
    $escaped = escapeshellarg($cleanTarget);

    // Retrieve container details before update
    $inspectRaw = @shell_exec("docker inspect {$escaped} 2>/dev/null");
    if (empty($inspectRaw)) {
        $rawEscaped = escapeshellarg($target);
        $inspectRaw = @shell_exec("docker inspect {$rawEscaped} 2>/dev/null");
        if (!empty($inspectRaw)) {
            $cleanTarget = $target;
            $escaped = $rawEscaped;
        }
    }

    if (empty($inspectRaw)) {
        json_output(['status' => 'error', 'message' => "未在系统中找到容器 [{$cleanTarget}]"]);
        return;
    }

    $inspectArr = @json_decode($inspectRaw, true);
    if (!is_array($inspectArr) || empty($inspectArr[0])) {
        json_output(['status' => 'error', 'message' => "无法解析容器 [{$cleanTarget}] 的配置信息"]);
        return;
    }
    $c = $inspectArr[0];

    $oldId = $c['Id'] ?? '';
    $oldImgId = $c['Image'] ?? '';
    $imageName = $c['Config']['Image'] ?? '';
    $wasRunning = !empty($c['State']['Running']);

    if (empty($imageName)) {
        json_output(['status' => 'error', 'message' => "无法获取容器 [{$cleanTarget}] 的镜像名称"]);
        return;
    }

    $updaterOut = '';
    $updated = false;

    // 1. If container belongs to a Docker Compose stack, use docker compose
    $composeWorkingDir = $c['Config']['Labels']['com.docker.compose.project.working_dir'] ?? '';
    $composeService = $c['Config']['Labels']['com.docker.compose.service'] ?? '';
    if (!empty($composeWorkingDir) && is_dir($composeWorkingDir)) {
        $composeCmd = get_compose_cmd();
        $svcArg = !empty($composeService) ? escapeshellarg($composeService) : '';
        $cmdCompose = "cd " . escapeshellarg($composeWorkingDir) . " && {$composeCmd} pull {$svcArg} 2>&1 && {$composeCmd} up -d {$svcArg} 2>&1";
        $updaterOut .= @shell_exec($cmdCompose) . "\n";

        $newId = trim(@shell_exec("docker inspect --format '{{.Id}}' {$escaped} 2>/dev/null"));
        $newImgId = trim(@shell_exec("docker inspect --format '{{.Image}}' {$escaped} 2>/dev/null"));
        if (!empty($newId) && ($newId !== $oldId || $newImgId !== $oldImgId)) {
            $updated = true;
        }
    }

    // Native Unraid updater script (triggers WebGUI's official update process)
    $unraidUpdater = '/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate';
    if (!$updated && file_exists($unraidUpdater)) {
        $upCmd = "{$unraidUpdater} update {$escaped} 2>&1";
        $upOut = @shell_exec($upCmd);
        if (!empty(trim($upOut)) && stripos($upOut, 'unknown command') === false && stripos($upOut, 'usage') === false) {
            $updaterOut .= $upOut . "\n";
            $newId = trim(@shell_exec("docker inspect --format '{{.Id}}' {$escaped} 2>/dev/null"));
            $newImgId = trim(@shell_exec("docker inspect --format '{{.Image}}' {$escaped} 2>/dev/null"));
            if (!empty($newId) && ($newId !== $oldId || $newImgId !== $oldImgId)) {
                $updated = true;
            }
        }
        if (!$updated) {
            $upCmd2 = "{$unraidUpdater} {$escaped} 2>&1";
            $upOut2 = @shell_exec($upCmd2);
            if (!empty(trim($upOut2)) && stripos($upOut2, 'unknown command') === false && stripos($upOut2, 'usage') === false) {
                $updaterOut .= $upOut2 . "\n";
                $newId = trim(@shell_exec("docker inspect --format '{{.Id}}' {$escaped} 2>/dev/null"));
                $newImgId = trim(@shell_exec("docker inspect --format '{{.Image}}' {$escaped} 2>/dev/null"));
                if (!empty($newId) && ($newId !== $oldId || $newImgId !== $oldImgId)) {
                    $updated = true;
                }
            }
        }
    }

    // 2. Standard Container Recreation: Pull Image -> Backup -> Recreate
    if (!$updated) {
        // Step A: Pull latest image first
        $pullOut = @shell_exec("docker pull " . escapeshellarg($imageName) . " 2>&1");
        $updaterOut .= $pullOut . "\n";

        $latestPulledImgId = trim(@shell_exec("docker inspect --format '{{.Id}}' " . escapeshellarg($imageName) . " 2>/dev/null"));
        if (empty($latestPulledImgId)) {
            json_output([
                'status' => 'error',
                'message' => "拉取最新镜像 [{$imageName}] 失败：\n" . trim(substr($pullOut, 0, 300)),
                'output' => trim($updaterOut)
            ]);
            return;
        }

        // Step B: Perform safe atomic container recreation
        $recreateResult = docker_recreate_container($cleanTarget, $imageName, $c);
        if (!empty($recreateResult['output'])) {
            $updaterOut .= $recreateResult['output'] . "\n";
        }

        if ($recreateResult['success']) {
            $updated = true;
            $newId = $recreateResult['new_id'] ?? '';
        } else {
            json_output([
                'status' => 'error',
                'message' => "容器重新创建失败（已安全还原旧容器）：\n" . ($recreateResult['error'] ?? '未知错误'),
                'output' => trim($updaterOut)
            ]);
            return;
        }
    }

    if ($updated) {
        // 1. Immediately update Unraid official docker.json to mark container up-to-date
        $jsonCandidates = [
            '/usr/local/emhttp/state/plugins/dynamix.docker.manager/docker.json',
            '/var/local/emhttp/plugins/dynamix.docker.manager/docker.json',
            '/var/local/emhttp/docker.json',
            '/tmp/docker.json'
        ];
        foreach ($jsonCandidates as $jf) {
            if (file_exists($jf)) {
                $rawJ = @file_get_contents($jf);
                if ($rawJ) {
                    $arrJ = @json_decode($rawJ, true);
                    if (is_array($arrJ)) {
                        $targetKeys = [$cleanTarget, 'my-' . $cleanTarget, ltrim($cleanTarget, '/')];
                        $modifiedJ = false;
                        foreach ($targetKeys as $tk) {
                            if (isset($arrJ[$tk]) && is_array($arrJ[$tk])) {
                                $arrJ[$tk]['updated'] = 'true';
                                $modifiedJ = true;
                            }
                        }
                        if ($modifiedJ) {
                            @file_put_contents($jf, json_encode($arrJ, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
                            @touch($jf);
                        }
                    }
                }
            }
        }

        // 2. Immediately update Unraid unraid-update-status.json to synchronize local digest with remote
        $statusFiles = [
            '/var/lib/docker/unraid-update-status.json',
            '/var/local/emhttp/plugins/dynamix.docker.manager/unraid-update-status.json'
        ];
        $newDigestRaw = trim(@shell_exec("docker inspect --format '{{range .RepoDigests}}{{.}} {{end}}' " . escapeshellarg($imageName) . " 2>/dev/null"));
        $newDigest = '';
        if (!empty($newDigestRaw)) {
            $partsD = explode(' ', $newDigestRaw);
            foreach ($partsD as $pd) {
                if (strpos($pd, '@sha256:') !== false) {
                    $newDigest = substr($pd, strpos($pd, '@sha256:') + 1);
                    break;
                }
            }
        }
        foreach ($statusFiles as $sf) {
            if (file_exists($sf)) {
                $rawS = @file_get_contents($sf);
                if ($rawS) {
                    $arrS = @json_decode($rawS, true);
                    if (is_array($arrS)) {
                        $lookupImgs = [$imageName, $imageName . ':latest', preg_replace('/:latest$/', '', $imageName)];
                        $modS = false;
                        foreach ($lookupImgs as $li) {
                            if (isset($arrS[$li]) && is_array($arrS[$li])) {
                                $arrS[$li]['status'] = 'true';
                                if (!empty($newDigest)) {
                                    $arrS[$li]['local'] = $newDigest;
                                    $arrS[$li]['remote'] = $newDigest;
                                } elseif (!empty($arrS[$li]['remote'])) {
                                    $arrS[$li]['local'] = $arrS[$li]['remote'];
                                }
                                $modS = true;
                            }
                        }
                        if ($modS) {
                            @file_put_contents($sf, json_encode($arrS, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
                            @touch($sf);
                        }
                    }
                }
            }
        }

        // 3. Trigger official Unraid dockerupdate check in background
        if (file_exists('/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate.php')) {
            @exec("nohup php /usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate.php check >/dev/null 2>&1 &");
        } elseif (file_exists('/usr/local/emhttp/plugins/dynamix.docker.manager/include/DockerUpdate.php')) {
            @exec("nohup php /usr/local/emhttp/plugins/dynamix.docker.manager/include/DockerUpdate.php >/dev/null 2>&1 &");
        }

        // Clean up Unraid docker.ini entry to mark updated
        $iniFile = '/var/local/emhttp/docker.ini';
        if (file_exists($iniFile)) {
            $rawIni = @file_get_contents($iniFile);
            if ($rawIni) {
                $iniLines = explode("\n", $rawIni);
                $outIniLines = [];
                $inTargetSec = false;
                foreach ($iniLines as $iLine) {
                    $trimL = trim($iLine);
                    if (strpos($trimL, '[') === 0 && substr($trimL, -1) === ']') {
                        $sName = substr($trimL, 1, -1);
                        $cleanSName = preg_replace('/^my-/', '', $sName);
                        $inTargetSec = (
                            $sName === $cleanTarget || 
                            $cleanSName === $cleanTarget || 
                            $sName === 'my-' . $cleanTarget ||
                            ltrim($sName, '/') === $cleanTarget || 
                            strtolower($sName) === strtolower($cleanTarget) ||
                            strtolower($cleanSName) === strtolower($cleanTarget) ||
                            (!empty($imageName) && ($sName === $imageName || strtolower($sName) === strtolower($imageName)))
                        );
                    } elseif ($inTargetSec && strpos($iLine, '=') !== false) {
                        $parts = explode('=', $iLine, 2);
                        $kTrim = strtolower(trim($parts[0]));
                        if ($kTrim === 'updated') {
                            $iLine = 'updated="true"';
                        } elseif ($kTrim === 'update') {
                            $iLine = 'update="false"';
                        } elseif ($kTrim === 'status') {
                            $iLine = 'status=""';
                        } elseif ($kTrim === 'install') {
                            $iLine = 'install=""';
                        }
                    }
                    $outIniLines[] = $iLine;
                }
                @file_put_contents($iniFile, implode("\n", $outIniLines));
            }
        }

        // Thoroughly purge old update notifications for this container across all notif folders
        $allNotifDirs = ['/tmp/notifications/unread', '/tmp/notifications/descriptions', '/tmp/notifications/archive', '/tmp/notifications'];
        foreach ($allNotifDirs as $chkDir) {
            if (!is_dir($chkDir)) continue;
            $cFiles = @scandir($chkDir);
            if (!$cFiles) continue;
            foreach ($cFiles as $cf) {
                if ($cf === '.' || $cf === '..') continue;
                $cfp = "{$chkDir}/{$cf}";
                if (is_file($cfp)) {
                    $cText = @file_get_contents($cfp);
                    if ($cText && (stripos($cText, $cleanTarget) !== false || stripos($cf, $cleanTarget) !== false)) {
                        @unlink($cfp);
                    }
                }
            }
        }

        // Prune dangling images left by recreation
        @shell_exec("docker image prune -f 2>/dev/null");

        // Touch docker.ini to notify Unraid emhttp file watchers
        if (file_exists($iniFile)) {
            @touch($iniFile);
        }

        // Trigger official Unraid dockerupdate check now that the container is on the new image
        if (file_exists('/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate')) {
            @exec("nohup /usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate check >/dev/null 2>&1 &");
        }

        $newContainerImgId = trim(@shell_exec("docker inspect --format '{{.Image}}' {$escaped} 2>/dev/null"));
        $cleanShortImgId = preg_replace('/^sha256:/', '', $newContainerImgId);
        $cleanShortImgId = substr($cleanShortImgId, 0, 12);

        // Get actual RepoDigest SHA256 (e.g. c555c6e1c8af2aea...)
        $newRepoDigestsRaw = trim(@shell_exec("docker inspect --format '{{range .RepoDigests}}{{.}} {{end}}' " . escapeshellarg($imageName) . " 2>/dev/null"));
        if (empty($newRepoDigestsRaw) && !empty($newContainerImgId)) {
            $newRepoDigestsRaw = trim(@shell_exec("docker inspect --format '{{range .RepoDigests}}{{.}} {{end}}' " . escapeshellarg($newContainerImgId) . " 2>/dev/null"));
        }
        $newSha256 = '';
        if (!empty($newRepoDigestsRaw)) {
            if (preg_match('/sha256:([a-f0-9]{64})/', $newRepoDigestsRaw, $m)) {
                $newSha256 = $m[1];
            }
        }

        $newContainerImgCreated = trim(@shell_exec("docker inspect --format '{{.Created}}' " . escapeshellarg($newContainerImgId) . " 2>/dev/null"));
        $containerCreated = trim(@shell_exec("docker inspect --format '{{.Created}}' {$escaped} 2>/dev/null"));

        json_output([
            'status' => 'success',
            'message' => "容器 [{$cleanTarget}] 升级成功！已更新至最新版本" . ($wasRunning ? "并已重新运行。" : "（保持停止状态）。"),
            'details' => [
                'container' => $cleanTarget,
                'old_container_id' => substr($oldId, 0, 12),
                'new_container_id' => !empty($newId) ? substr($newId, 0, 12) : substr($oldId, 0, 12),
                'old_image_id' => substr(preg_replace('/^sha256:/', '', $oldImgId), 0, 12),
                'new_image_id' => $cleanShortImgId,
                'new_digest' => $newSha256,
                'new_digest_short' => !empty($newSha256) ? (substr($newSha256, 0, 16) . '...') : '',
                'image_created' => $newContainerImgCreated,
                'container_created' => $containerCreated,
                'output' => trim($updaterOut)
            ]
        ]);
    } else {
        json_output([
            'status' => 'error',
            'message' => "容器升级未能完成：未检测到新容器创建或配置未变动。\n" . trim(substr($updaterOut, 0, 400)),
            'output' => trim($updaterOut)
        ]);
    }
}

// -------------------------------------------------------------
// Safe Atomic Docker Container Recreator
// -------------------------------------------------------------
function docker_recreate_container($cleanTarget, $imageName, $c) {
    $oldId = $c['Id'] ?? '';
    $wasRunning = !empty($c['State']['Running']);
    $backupName = $cleanTarget . '_backup_' . time();
    $escapedTarget = escapeshellarg($cleanTarget);
    $escapedBackup = escapeshellarg($backupName);

    // 1. Check if Unraid XML template exists for this container
    $xmlPath = "/boot/config/plugins/dockerMan/templates-user/my-{$cleanTarget}.xml";
    $useXml = false;
    $xml = null;
    if (file_exists($xmlPath)) {
        $xml = @simplexml_load_file($xmlPath);
        if ($xml && !empty($xml->Repository)) {
            $useXml = true;
        }
    }

    $createCmdArgs = [];
    $createCmdArgs[] = "--name " . $escapedTarget;

    if ($useXml) {
        $repo = trim((string)$xml->Repository);
        $network = trim((string)$xml->Network) ?: 'bridge';
        $myIp = trim((string)$xml->MyIP);
        $privileged = (strtolower(trim((string)$xml->Privileged)) === 'true');
        $extraParams = trim((string)$xml->ExtraParams);
        $postArgs = trim((string)$xml->PostArgs);
        $icon = trim((string)$xml->Icon);
        $webui = trim((string)$xml->WebUI);
        $cpuSet = trim((string)$xml->CPUset);

        $createCmdArgs[] = "--net " . escapeshellarg($network);
        if (!empty($myIp)) {
            $createCmdArgs[] = "--ip " . escapeshellarg($myIp);
        }
        if ($privileged) {
            $createCmdArgs[] = "--privileged";
        }
        if (!empty($cpuSet)) {
            $createCmdArgs[] = "--cpuset-cpus " . escapeshellarg($cpuSet);
        }
        if (!empty($icon)) {
            $createCmdArgs[] = "-l " . escapeshellarg("net.unraid.docker.icon=" . $icon);
        }
        if (!empty($webui)) {
            $createCmdArgs[] = "-l " . escapeshellarg("net.unraid.docker.webui=" . $webui);
        }
        $createCmdArgs[] = "-l net.unraid.docker.managed=dockerman";

        if (isset($xml->Config)) {
            foreach ($xml->Config as $cfg) {
                $type = trim((string)$cfg['Type']);
                $target = trim((string)$cfg['Target']);
                $mode = trim((string)$cfg['Mode']);
                $val = trim((string)$cfg);

                if ($type === 'Port' && !empty($val) && !empty($target)) {
                    $pStr = $val . ':' . $target . (!empty($mode) ? '/' . $mode : '');
                    $createCmdArgs[] = "-p " . escapeshellarg($pStr);
                } elseif ($type === 'Path' && !empty($val) && !empty($target)) {
                    $vStr = $val . ':' . $target . (!empty($mode) ? ':' . $mode : '');
                    $createCmdArgs[] = "-v " . escapeshellarg($vStr);
                } elseif ($type === 'Variable' && !empty($target)) {
                    $createCmdArgs[] = "-e " . escapeshellarg($target . '=' . $val);
                } elseif ($type === 'Device' && !empty($val)) {
                    $dStr = $val . (!empty($target) ? ':' . $target : '') . (!empty($mode) ? ':' . $mode : '');
                    $createCmdArgs[] = "--device " . escapeshellarg($dStr);
                } elseif ($type === 'Label' && !empty($target)) {
                    $createCmdArgs[] = "-l " . escapeshellarg($target . '=' . $val);
                }
            }
        }

        if (!empty($extraParams)) {
            $createCmdArgs[] = $extraParams;
        }
        if (stripos($extraParams, '--restart') === false) {
            $createCmdArgs[] = "--restart unless-stopped";
        }

        $finalImage = !empty($repo) ? $repo : $imageName;
        $finalImageAndArgs = escapeshellarg($finalImage) . (!empty($postArgs) ? ' ' . $postArgs : '');
    } else {
        // Fallback: Reconstruct from docker inspect
        $netMode = $c['HostConfig']['NetworkMode'] ?? 'bridge';
        if (!empty($netMode)) {
            $createCmdArgs[] = "--net " . escapeshellarg($netMode);
        }

        $restartPolicy = $c['HostConfig']['RestartPolicy']['Name'] ?? 'unless-stopped';
        if (!empty($restartPolicy) && $restartPolicy !== 'no') {
            $maxRetry = $c['HostConfig']['RestartPolicy']['MaximumRetryCount'] ?? 0;
            $rStr = ($restartPolicy === 'on-failure' && $maxRetry > 0) ? "on-failure:{$maxRetry}" : $restartPolicy;
            $createCmdArgs[] = "--restart " . escapeshellarg($rStr);
        }

        if (!empty($c['HostConfig']['Privileged'])) {
            $createCmdArgs[] = "--privileged";
        }

        if (!empty($c['HostConfig']['PortBindings']) && is_array($c['HostConfig']['PortBindings'])) {
            foreach ($c['HostConfig']['PortBindings'] as $cPortProto => $bindings) {
                if (is_array($bindings)) {
                    foreach ($bindings as $bind) {
                        $hIp = trim($bind['HostIp'] ?? '');
                        $hPort = trim($bind['HostPort'] ?? '');
                        if (!empty($hPort)) {
                            if (!empty($hIp) && $hIp !== '0.0.0.0') {
                                $createCmdArgs[] = "-p " . escapeshellarg("{$hIp}:{$hPort}:{$cPortProto}");
                            } else {
                                $createCmdArgs[] = "-p " . escapeshellarg("{$hPort}:{$cPortProto}");
                            }
                        }
                    }
                }
            }
        }

        if (!empty($c['HostConfig']['Binds']) && is_array($c['HostConfig']['Binds'])) {
            foreach ($c['HostConfig']['Binds'] as $bindStr) {
                if (!empty($bindStr)) {
                    $createCmdArgs[] = "-v " . escapeshellarg($bindStr);
                }
            }
        }

        if (!empty($c['Config']['Env']) && is_array($c['Config']['Env'])) {
            foreach ($c['Config']['Env'] as $envStr) {
                if (!preg_match('/^(HOSTNAME|PATH)=/', $envStr)) {
                    $createCmdArgs[] = "-e " . escapeshellarg($envStr);
                }
            }
        }

        if (!empty($c['HostConfig']['Devices']) && is_array($c['HostConfig']['Devices'])) {
            foreach ($c['HostConfig']['Devices'] as $dev) {
                $hPath = $dev['PathOnHost'] ?? '';
                $cPath = $dev['PathInContainer'] ?? $hPath;
                $perm = $dev['CgroupPermissions'] ?? 'rwm';
                if (!empty($hPath)) {
                    $createCmdArgs[] = "--device " . escapeshellarg("{$hPath}:{$cPath}:{$perm}");
                }
            }
        }

        if (!empty($c['Config']['Labels']) && is_array($c['Config']['Labels'])) {
            foreach ($c['Config']['Labels'] as $lKey => $lVal) {
                $createCmdArgs[] = "-l " . escapeshellarg("{$lKey}={$lVal}");
            }
        }

        $shmSize = $c['HostConfig']['ShmSize'] ?? 0;
        if ($shmSize > 67108864) {
            $createCmdArgs[] = "--shm-size=" . escapeshellarg($shmSize);
        }

        $finalImageAndArgs = escapeshellarg($imageName);
        if (!empty($c['Config']['Cmd']) && is_array($c['Config']['Cmd'])) {
            $cmdParts = array_map('escapeshellarg', $c['Config']['Cmd']);
            $finalImageAndArgs .= ' ' . implode(' ', $cmdParts);
        }
    }

    // Step C: Atomic Rename old container to backup
    if ($wasRunning) {
        @shell_exec("docker stop -t 15 {$escapedTarget} 2>&1");
    }

    $renameOut = trim(@shell_exec("docker rename {$escapedTarget} {$escapedBackup} 2>&1"));
    $checkBackup = trim(@shell_exec("docker inspect --format '{{.Id}}' {$escapedBackup} 2>/dev/null"));
    if (empty($checkBackup)) {
        if ($wasRunning) {
            @shell_exec("docker start {$escapedTarget} 2>&1");
        }
        return [
            'success' => false,
            'error' => "旧容器备份重命名失败: {$renameOut}",
            'output' => $renameOut
        ];
    }

    // Step D: Recreate the container
    // If was running, run -d; if was stopped, create (keeps it stopped!)
    $dockerVerb = $wasRunning ? 'docker run -d' : 'docker create';
    $runCmd = "{$dockerVerb} " . implode(' ', $createCmdArgs) . " " . $finalImageAndArgs . " 2>&1";
    $createOut = trim(@shell_exec($runCmd));

    $newId = trim(@shell_exec("docker inspect --format '{{.Id}}' {$escapedTarget} 2>/dev/null"));

    // Step E: Verify new container
    if (!empty($newId) && $newId !== $oldId) {
        // Success! Remove backup container
        @shell_exec("docker rm -f {$escapedBackup} 2>/dev/null");
        return [
            'success' => true,
            'new_id' => $newId,
            'used_xml' => $useXml,
            'output' => "Container recreated successfully via {$dockerVerb}.\n" . $createOut
        ];
    } else {
        // Recreation failed! Rollback!
        @shell_exec("docker rm -f {$escapedTarget} 2>/dev/null");
        @shell_exec("docker rename {$escapedBackup} {$escapedTarget} 2>&1");
        if ($wasRunning) {
            @shell_exec("docker start {$escapedTarget} 2>&1");
        }
        return [
            'success' => false,
            'error' => "新建容器失败，已安全回滚保留原容器。\n命令输出: {$createOut}",
            'output' => "CMD: {$runCmd}\nOUT: {$createOut}"
        ];
    }
}

// -------------------------------------------------------------
// Self Update API.php
// -------------------------------------------------------------
function handle_self_update_api() {
    @set_time_limit(120);
    $timestamp = time();
    $urls = [
        'https://api.github.com/repos/wangzh6859/unraid2/contents/api.php?ref=main&t=' . $timestamp,
        'https://raw.githubusercontent.com/wangzh6859/unraid2/main/api.php?t=' . $timestamp,
        'https://ghproxy.net/https://raw.githubusercontent.com/wangzh6859/unraid2/main/api.php?t=' . $timestamp,
        'https://cdn.jsdelivr.net/gh/wangzh6859/unraid2@main/api.php?t=' . $timestamp,
    ];

    $newContent = null;
    $usedUrl = '';
    $lastErr = '';

    foreach ($urls as $u) {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $u);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 25);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (compatible; Unraid-API-Updater/1.0)');
        $headers = ['Cache-Control: no-cache', 'Pragma: no-cache'];
        if (strpos($u, 'api.github.com') !== false) {
            $headers[] = 'Accept: application/vnd.github.v3.raw';
        }
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        $res = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($httpCode === 200 && $res && strlen($res) > 50000 && strpos($res, '<?php') !== false && strpos($res, 'UNRAID_API_VERSION') !== false) {
            $newContent = $res;
            $usedUrl = $u;
            break;
        } else {
            $lastErr = "HTTP {$httpCode}: " . ($err ?: substr((string)$res, 0, 100));
        }
    }

    if (!$newContent) {
        json_output([
            'status' => 'error',
            'message' => "在线获取最新 api.php 失败，请检查服务器网络连接。错误：{$lastErr}"
        ]);
        return;
    }

    $currentFile = __FILE__;
    $backupFile = $currentFile . '.bak.' . time();
    @copy($currentFile, $backupFile);

    $written = @file_put_contents($currentFile, $newContent);
    if ($written === false || $written < 50000) {
        if (file_exists($backupFile)) {
            @copy($backupFile, $currentFile);
        }
        json_output([
            'status' => 'error',
            'message' => "写入文件 {$currentFile} 失败，可能缺少写入权限。"
        ]);
        return;
    }

    @unlink($backupFile);

    $updatedVer = '最新';
    if (preg_match("/define\('UNRAID_API_VERSION',\s*'([^']+)'\)/", $newContent, $m)) {
        $updatedVer = $m[1];
    }

    json_output([
        'status' => 'success',
        'message' => "api.php 在线更新成功！已通过 GitHub 仓库更新至版本 {$updatedVer}（大小: " . round($written / 1024, 1) . " KB）。",
        'api_version' => $updatedVer,
        'file' => $currentFile,
        'source' => $usedUrl,
        'size' => $written
    ]);
}

function handle_update_api_file() {
    @set_time_limit(60);
    $content = @file_get_contents('php://input');
    if (empty($content) && isset($_POST['code'])) {
        $content = $_POST['code'];
    }
    if (empty($content) || strlen($content) < 50000 || strpos($content, '<?php') === false || strpos($content, 'UNRAID_API_VERSION') === false) {
        json_output(['status' => 'error', 'message' => '推送的 API 代码无效或不完整'], 400);
    }
    
    $currentFile = __FILE__;
    $backupFile = $currentFile . '.bak.' . time();
    @copy($currentFile, $backupFile);

    $written = @file_put_contents($currentFile, $content);
    if ($written === false || $written < 50000) {
        if (file_exists($backupFile)) {
            @copy($backupFile, $currentFile);
        }
        json_output(['status' => 'error', 'message' => "写入文件 {$currentFile} 失败，可能缺少写入权限。"], 500);
    }
    @unlink($backupFile);

    // Attempt to write .user.ini in api directory for PHP-FPM upload limit expansion
    @file_put_contents(dirname($currentFile) . '/.user.ini', "upload_max_filesize = 128M\npost_max_size = 128M\nmemory_limit = 512M\n");

    $version = 'latest';
    if (preg_match("/define\('UNRAID_API_VERSION',\s*'([^']+)'\)/", $content, $m)) {
        $version = $m[1];
    }

    json_output([
        'status' => 'success',
        'message' => "API 文件热更新成功！已直接升级至版本 {$version}（大小: " . round($written / 1024, 1) . " KB）。",
        'api_version' => $version,
        'size' => $written
    ]);
}

// -------------------------------------------------------------
function get_compose_cmd() {
    static $cmd = null;
    if ($cmd !== null) return $cmd;
    $check = @shell_exec('docker compose version 2>/dev/null');
    if ($check && strpos($check, 'Docker Compose') !== false) {
        $cmd = 'docker compose';
        return $cmd;
    }
    $check2 = @shell_exec('docker-compose version 2>/dev/null');
    if ($check2 && strpos($check2, 'docker-compose') !== false) {
        $cmd = 'docker-compose';
        return $cmd;
    }
    $cmd = 'docker compose';
    return $cmd;
}

function find_compose_file($target, $path = '') {
    $target = trim((string)$target);
    $path = trim((string)$path);

    if (!empty($path)) {
        if (is_file($path)) return $path;
        if (is_dir($path)) {
            $candidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
            foreach ($candidates as $c) {
                if (file_exists("{$path}/{$c}")) return "{$path}/{$c}";
            }
        }
    }

    // 1. Authoritative: Inspect Docker container labels for this compose project
    if (!empty($target)) {
        $escapedTarget = escapeshellarg("label=com.docker.compose.project={$target}");
        $fmtFiles = '{{index .Config.Labels "com.docker.compose.project.config_files"}}';
        $cFilesRaw = @shell_exec("docker ps -a --filter {$escapedTarget} --format " . escapeshellarg($fmtFiles) . " 2>/dev/null");
        if (!empty($cFilesRaw)) {
            $cFiles = array_filter(array_map('trim', explode("\n", $cFilesRaw)));
            foreach ($cFiles as $cf) {
                if (file_exists($cf) && is_file($cf)) return $cf;
            }
        }
        $fmtDir = '{{index .Config.Labels "com.docker.compose.project.working_dir"}}';
        $cWorkingDirRaw = @shell_exec("docker ps -a --filter {$escapedTarget} --format " . escapeshellarg($fmtDir) . " 2>/dev/null");
        if (!empty($cWorkingDirRaw)) {
            $dirs = array_filter(array_map('trim', explode("\n", $cWorkingDirRaw)));
            foreach ($dirs as $d) {
                $candidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
                foreach ($candidates as $c) {
                    if (file_exists("{$d}/{$c}")) return "{$d}/{$c}";
                }
            }
        }
    }

    // 2. Search standard Unraid and AppData directories
    $searchDirs = [
        '/boot/config/plugins/compose.manager/projects',
        '/boot/config/plugins/docker.compose/projects',
        '/mnt/user/appdata/compose',
        '/mnt/user/appdata/docker-compose',
        '/mnt/user/appdata'
    ];
    $candidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

    foreach ($searchDirs as $d) {
        if (!is_dir($d)) continue;
        // Direct match
        foreach ($candidates as $c) {
            if (file_exists("{$d}/{$target}/{$c}")) return "{$d}/{$target}/{$c}";
        }
        // Case-insensitive match
        $items = @scandir($d);
        if ($items) {
            foreach ($items as $item) {
                if ($item === '.' || $item === '..') continue;
                if (strcasecmp($item, $target) === 0 && is_dir("{$d}/{$item}")) {
                    foreach ($candidates as $c) {
                        if (file_exists("{$d}/{$item}/{$c}")) return "{$d}/{$item}/{$c}";
                    }
                }
            }
        }
    }

    return '';
}

function handle_compose_list() {
    $searchDirs = [
        '/boot/config/plugins/compose.manager/projects',
        '/boot/config/plugins/docker.compose/projects',
        '/mnt/user/appdata/compose',
        '/mnt/user/appdata/docker-compose'
    ];
    
    if (!empty($_GET['root_dir']) && is_dir($_GET['root_dir'])) {
        array_unshift($searchDirs, rtrim($_GET['root_dir'], '/'));
    }

    // Discover working directories from compose containers directly
    $fmtWorkDir = '{{index .Config.Labels "com.docker.compose.project.working_dir"}}';
    $psDirsRaw = @shell_exec('docker ps -a --filter ' . escapeshellarg('label=com.docker.compose.project') . ' --format ' . escapeshellarg($fmtWorkDir) . ' 2>/dev/null');
    if ($psDirsRaw) {
        foreach (explode("\n", trim($psDirsRaw)) as $pDir) {
            $pDir = trim($pDir);
            if (!empty($pDir) && is_dir($pDir)) {
                $parentDir = dirname($pDir);
                if (!in_array($parentDir, $searchDirs)) {
                    $searchDirs[] = $parentDir;
                }
            }
        }
    }

    $projects = [];
    $seenNames = [];

    // Pre-query all compose-labeled containers
    $composeContainers = [];
    $fmtPs = '{{.Label "com.docker.compose.project"}}' . "\t" . '{{.Label "com.docker.compose.service"}}' . "\t" . '{{.Names}}' . "\t" . '{{.Status}}' . "\t" . '{{.State}}';
    $psOut = @shell_exec('docker ps -a --filter ' . escapeshellarg('label=com.docker.compose.project') . ' --format ' . escapeshellarg($fmtPs) . ' 2>/dev/null');
    if ($psOut) {
        foreach (explode("\n", trim($psOut)) as $line) {
            $cols = explode("\t", $line);
            if (count($cols) >= 4) {
                $proj = trim($cols[0]);
                $srv = trim($cols[1]);
                $cName = trim($cols[2]);
                $state = trim(isset($cols[4]) ? $cols[4] : '');
                $isRunning = (strpos(trim($cols[3]), 'Up') === 0) || ($state === 'running');
                if (!isset($composeContainers[$proj])) $composeContainers[$proj] = [];
                $composeContainers[$proj][] = [
                    'service' => $srv,
                    'name' => $cName,
                    'is_running' => $isRunning
                ];
            }
        }
    }

    foreach ($searchDirs as $dir) {
        if (!is_dir($dir)) continue;
        $items = @scandir($dir);
        if (!$items) continue;

        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            $projDir = "{$dir}/{$item}";
            if (!is_dir($projDir)) continue;

            $projName = $item;
            if (isset($seenNames[$projName])) continue;

            // Find compose file
            $yamlFile = '';
            $candidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
            foreach ($candidates as $c) {
                if (file_exists("{$projDir}/{$c}")) {
                    $yamlFile = "{$projDir}/{$c}";
                    break;
                }
            }
            if (!$yamlFile) continue;

            $seenNames[$projName] = true;

            // Extract service names from YAML
            $services = [];
            $yamlContent = @file_get_contents($yamlFile);
            if ($yamlContent) {
                if (preg_match('/^services:\s*(.*?)(?=\n[a-zA-Z0-9_-]+:|$)/ms', $yamlContent, $sm)) {
                    if (preg_match_all('/^[ \t]{2,4}([a-zA-Z0-9_-]+):/m', $sm[1], $srvMatches)) {
                        $services = array_values(array_unique($srvMatches[1]));
                    }
                }
            }

            // Calculate status
            $containers = isset($composeContainers[$projName]) ? $composeContainers[$projName] : (isset($composeContainers[strtolower($projName)]) ? $composeContainers[strtolower($projName)] : []);
            $runningCount = 0;
            $totalCount = count($containers);
            foreach ($containers as $c) {
                if ($c['is_running']) $runningCount++;
            }

            $status = 'stopped';
            if ($totalCount > 0) {
                if ($runningCount === $totalCount) $status = 'running';
                elseif ($runningCount > 0) $status = 'partial';
                else $status = 'stopped';
            }

            $projects[] = [
                'name' => $projName,
                'path' => $projDir,
                'yaml_file' => $yamlFile,
                'status' => $status,
                'services' => $services,
                'running_count' => $runningCount,
                'total_count' => $totalCount > 0 ? $totalCount : count($services),
                'containers' => $containers,
                'updated_at' => filemtime($yamlFile)
            ];
        }
    }

    json_output([
        'status' => 'success',
        'total' => count($projects),
        'projects' => $projects
    ]);
}

function handle_compose_action() {
    @set_time_limit(300);
    $target = isset($_GET['target']) ? trim($_GET['target']) : '';
    $cmd = isset($_GET['compose_cmd']) ? trim($_GET['compose_cmd']) : (isset($_GET['cmd']) ? trim($_GET['cmd']) : 'up');
    $path = isset($_GET['path']) ? trim($_GET['path']) : '';

    if (empty($target) && empty($path)) {
        json_output(['status' => 'error', 'message' => '缺少堆栈项目名称或路径'], 400);
    }

    $yamlFile = find_compose_file($target, $path);
    if (empty($yamlFile) || !file_exists($yamlFile)) {
        json_output(['status' => 'error', 'message' => "未能找到堆栈 [{$target}] 的 Compose 配置文件"], 404);
    }

    $composeBin = get_compose_cmd();
    $escapedFile = escapeshellarg($yamlFile);
    $dir = dirname($yamlFile);
    $escapedDir = escapeshellarg($dir);
    $projectName = !empty($target) ? $target : basename($dir);
    $escapedProject = escapeshellarg($projectName);

    $execCmd = '';
    switch ($cmd) {
        case 'up':
        case 'start':
            $execCmd = "cd {$escapedDir} && {$composeBin} -p {$escapedProject} -f {$escapedFile} up -d 2>&1";
            break;
        case 'down':
        case 'stop':
            $execCmd = "cd {$escapedDir} && {$composeBin} -p {$escapedProject} -f {$escapedFile} down 2>&1";
            break;
        case 'restart':
            $execCmd = "cd {$escapedDir} && {$composeBin} -p {$escapedProject} -f {$escapedFile} restart 2>&1";
            break;
        case 'pull':
        case 'upgrade':
        case 'update':
            // Crucial fix: pull downloads latest images, and up -d immediately recreates the containers with the new images!
            $execCmd = "cd {$escapedDir} && {$composeBin} -p {$escapedProject} -f {$escapedFile} pull 2>&1 && {$composeBin} -p {$escapedProject} -f {$escapedFile} up -d --remove-orphans 2>&1";
            break;
        default:
            json_output(['status' => 'error', 'message' => "不支持的操作指令: {$cmd}"], 400);
    }

    $out = @shell_exec($execCmd);

    // If upgrading or updating, clean up dangling images and refresh Unraid status check
    if (in_array($cmd, ['pull', 'upgrade', 'update'])) {
        @shell_exec("docker image prune -f 2>/dev/null");
        if (file_exists('/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate.php')) {
            @exec("nohup php /usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate.php check >/dev/null 2>&1 &");
        } elseif (file_exists('/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate')) {
            @exec("nohup /usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate check >/dev/null 2>&1 &");
        }
    }

    json_output([
        'status' => 'success',
        'project' => $projectName,
        'action' => $cmd,
        'message' => in_array($cmd, ['pull', 'upgrade', 'update'])
            ? "堆栈 [{$projectName}] 已成功拉取最新镜像并完成容器重建升级！"
            : "堆栈 [{$projectName}] 操作 [{$cmd}] 执行完成。",
        'output' => trim((string)$out)
    ]);
}

function handle_compose_file() {
    $target = isset($_GET['target']) ? trim($_GET['target']) : '';
    $path = isset($_GET['path']) ? trim($_GET['path']) : '';
    
    $yamlFile = find_compose_file($target, $path);

    if (empty($yamlFile) || !file_exists($yamlFile)) {
        json_output(['status' => 'error', 'message' => "未找到堆栈 [{$target}] 的 YAML 配置文件"], 404);
    }

    $content = @file_get_contents($yamlFile);
    if ($content === false) {
        json_output(['status' => 'error', 'message' => "读取配置文件失败: {$yamlFile}"], 500);
    }

    json_output([
        'status' => 'success',
        'file' => $yamlFile,
        'content' => $content
    ]);
}

function handle_compose_save() {
    $input = file_get_contents('php://input');
    $data = @json_decode($input, true);
    if (!$data) $data = $_POST;

    $target = isset($data['target']) ? trim($data['target']) : '';
    $content = isset($data['content']) ? $data['content'] : '';
    $path = isset($data['path']) ? trim($data['path']) : '';

    if (empty($target) && empty($path)) {
        json_output(['status' => 'error', 'message' => 'Missing project name or path'], 400);
    }

    $yamlFile = !empty($path) ? $path : find_compose_file($target);
    if (empty($yamlFile)) {
        $baseDir = '/boot/config/plugins/compose.manager/projects';
        if (!is_dir($baseDir)) {
            $baseDir = '/mnt/user/appdata/compose';
            if (!is_dir($baseDir)) @mkdir($baseDir, 0777, true);
        }
        $projDir = "{$baseDir}/{$target}";
        if (!is_dir($projDir)) @mkdir($projDir, 0777, true);
        $yamlFile = "{$projDir}/docker-compose.yml";
    }

    $ok = @file_put_contents($yamlFile, $content);
    if ($ok === false) {
        json_output(['status' => 'error', 'message' => "Failed to write compose file to {$yamlFile}"], 500);
    }

    json_output([
        'status' => 'success',
        'message' => "Compose 文件已成功保存",
        'file' => $yamlFile
    ]);
}

function handle_compose_logs() {
    @set_time_limit(30);
    $target = isset($_GET['target']) ? trim($_GET['target']) : '';
    $path = isset($_GET['path']) ? trim($_GET['path']) : '';
    $lines = isset($_GET['lines']) ? (int)$_GET['lines'] : 150;
    if ($lines <= 0 || $lines > 1000) $lines = 150;

    $yamlFile = find_compose_file($target, $path);
    $out = '';

    if (!empty($yamlFile) && file_exists($yamlFile)) {
        $composeBin = get_compose_cmd();
        $escapedFile = escapeshellarg($yamlFile);
        $escapedDir = escapeshellarg(dirname($yamlFile));
        $projectName = !empty($target) ? $target : basename(dirname($yamlFile));
        $escapedProject = escapeshellarg($projectName);

        $out = @shell_exec("cd {$escapedDir} && timeout 6s {$composeBin} -p {$escapedProject} -f {$escapedFile} logs --no-color --tail={$lines} --timestamps 2>&1");
    }

    // Direct container fallback if compose logs returned empty or timed out
    if (empty(trim((string)$out)) && !empty($target)) {
        $escapedLabel = escapeshellarg("label=com.docker.compose.project={$target}");
        $cNamesRaw = @shell_exec("docker ps -a --filter {$escapedLabel} --format '{{.Names}}' 2>/dev/null");
        if (!empty($cNamesRaw)) {
            $cNames = array_filter(array_map('trim', explode("\n", $cNamesRaw)));
            $combinedLogs = [];
            foreach ($cNames as $cn) {
                $cLog = @shell_exec("timeout 4s docker logs --tail={$lines} --timestamps " . escapeshellarg($cn) . " 2>&1");
                if (!empty(trim((string)$cLog))) {
                    $combinedLogs[] = "=== 容器 [{$cn}] 日志 ===\n" . trim((string)$cLog);
                }
            }
            if (!empty($combinedLogs)) {
                $out = implode("\n\n", $combinedLogs);
            }
        }
    }

    json_output([
        'status' => 'success',
        'project' => $target,
        'logs' => (!empty(trim((string)$out))) ? trim((string)$out) : '暂无日志输出或容器尚未生成日志'
    ]);
}

// -------------------------------------------------------------
// System Event Alerts & Notification Center
// -------------------------------------------------------------
function handle_notifications() {
    // 1. Check System Time & NTP Drift
    $clientTime = isset($_GET['client_time']) ? (int)$_GET['client_time'] : 0;
    $serverNow = time();
    $serverTimeStr = date('Y-m-d H:i:s T');
    $timezone = @date_default_timezone_get();
    $driftSeconds = ($clientTime > 0) ? abs($serverNow - $clientTime) : 0;
    
    $timeWarning = null;
    $isNtpSynced = true;

    // Check NTP status if possible
    $timedate = @shell_exec('timedatectl status 2>/dev/null');
    if ($timedate) {
        if (preg_match('/System clock synchronized:\s*(no|false)/i', $timedate) || preg_match('/NTP service:\s*(inactive|disabled)/i', $timedate)) {
            $isNtpSynced = false;
        }
    }

    if ($driftSeconds > 30) {
        $isNtpSynced = false;
        $timeWarning = "系统时钟与手机相差 {$driftSeconds} 秒，可能未同步 NTP，将导致 Docker 镜像拉取与 SSL 证书异常！";
    } elseif (!$isNtpSynced) {
        $timeWarning = "系统 NTP 服务未同步或时钟未校准，建议检查系统时间与 NTP 配置。";
    }

    // 2. Read Unraid notifications from /tmp/notifications/
    $notifList = [];
    $unreadCount = 0;
    $unreadDir = '/tmp/notifications/unread';
    $archiveDir = '/tmp/notifications/archive';

    // Scan unread notifications
    if (is_dir($unreadDir)) {
        $files = @scandir($unreadDir);
        if ($files) {
            foreach ($files as $f) {
                if ($f === '.' || $f === '..') continue;
                $p = "{$unreadDir}/{$f}";
                $parsed = parse_notification_file($p, false);
                if ($parsed) {
                    $notifList[] = $parsed;
                    $unreadCount++;
                }
            }
        }
    }

    // Also scan archive (up to 20 recent)
    if (is_dir($archiveDir)) {
        $files = @scandir($archiveDir);
        if ($files) {
            rsort($files);
            $cnt = 0;
            foreach ($files as $f) {
                if ($f === '.' || $f === '..') continue;
                if ($cnt++ > 20) break;
                $p = "{$archiveDir}/{$f}";
                $parsed = parse_notification_file($p, true);
                if ($parsed) {
                    $notifList[] = $parsed;
                }
            }
        }
    }

    // If Unraid notifications are empty, synthesize hardware status from disks.ini
    if (empty($notifList) && file_exists('/var/local/emhttp/disks.ini')) {
        $ini = @parse_ini_file('/var/local/emhttp/disks.ini', true);
        if ($ini) {
            foreach ($ini as $name => $d) {
                $numErrors = isset($d['numErrors']) ? (int)$d['numErrors'] : 0;
                $temp = isset($d['temp']) ? (int)$d['temp'] : 0;
                if ($numErrors > 0) {
                    $notifList[] = [
                        'id' => 'disk_err_' . $name,
                        'importance' => 'alert',
                        'subject' => "磁盘 [{$name}] 存在读写/校验错误",
                        'description' => "检测到磁盘 {$name} 累计错误计数: {$numErrors}，请及时查看 S.M.A.R.T. 诊断并复查数据完整性。",
                        'timestamp' => date('Y-m-d H:i:s'),
                        'is_read' => false,
                    ];
                    $unreadCount++;
                } elseif ($temp >= 50) {
                    $notifList[] = [
                        'id' => 'disk_temp_' . $name,
                        'importance' => 'warning',
                        'subject' => "磁盘 [{$name}] 温度偏高 ({$temp}°C)",
                        'description' => "磁盘当前工作温度达到 {$temp}°C，超过推荐安全阈值，请检查机箱散热与风扇状态。",
                        'timestamp' => date('Y-m-d H:i:s'),
                        'is_read' => false,
                    ];
                    $unreadCount++;
                }
            }
        }
    }

    // Sort by timestamp desc
    usort($notifList, function($a, $b) {
        return strcmp($b['timestamp'], $a['timestamp']);
    });

    json_output([
        'status' => 'success',
        'time_status' => [
            'server_time' => $serverTimeStr,
            'timezone' => $timezone,
            'drift_seconds' => $driftSeconds,
            'synced' => $isNtpSynced,
            'warning' => $timeWarning,
        ],
        'unread_count' => $unreadCount,
        'total' => count($notifList),
        'notifications' => $notifList
    ]);
}

function parse_notification_file($filepath, $isArchive = false) {
    if (!file_exists($filepath)) return null;
    $raw = @file_get_contents($filepath);
    if (!$raw) return null;

    $id = basename($filepath);
    $importance = 'normal'; // normal, warning, alert
    $subject = '';
    $description = '';
    $timestamp = date('Y-m-d H:i:s', filemtime($filepath));

    $lines = explode("\n", $raw);
    foreach ($lines as $line) {
        $line = trim($line);
        if (empty($line) || $line[0] === '#' || $line[0] === '[') continue;
        $kv = explode('=', $line, 2);
        if (count($kv) === 2) {
            $k = strtolower(trim($kv[0]));
            $v = trim($kv[1], " \t\n\r\0\x0B\"'");
            if ($k === 'importance' || $k === 'type') {
                $importance = strtolower($v);
            } elseif ($k === 'subject' || $k === 'title') {
                $subject = $v;
            } elseif ($k === 'description' || $k === 'message') {
                $description = $v;
            } elseif ($k === 'timestamp' || $k === 'time') {
                $timestamp = is_numeric($v) ? date('Y-m-d H:i:s', (int)$v) : $v;
            }
        }
    }

    if (empty($subject)) {
        $subject = basename($filepath, '.txt');
    }
    if (empty($description)) {
        $description = trim($raw);
    }

    return [
        'id' => $id,
        'importance' => in_array($importance, ['alert', 'warning', 'normal']) ? $importance : 'normal',
        'subject' => $subject,
        'description' => $description,
        'timestamp' => $timestamp,
        'is_read' => $isArchive,
    ];
}

function handle_dismiss_notification() {
    $id = isset($_GET['id']) ? trim($_GET['id']) : (isset($_POST['id']) ? trim($_POST['id']) : '');
    if (empty($id)) {
        json_output(['status' => 'error', 'message' => 'Missing notification ID'], 400);
    }

    $unreadFile = "/tmp/notifications/unread/{$id}";
    $archiveDir = "/tmp/notifications/archive";
    if (file_exists($unreadFile)) {
        if (!is_dir($archiveDir)) @mkdir($archiveDir, 0777, true);
        @rename($unreadFile, "{$archiveDir}/{$id}");
    }

    json_output(['status' => 'success', 'message' => '已标记为已读', 'id' => $id]);
}

function handle_vm_action($action) {
    $target = isset($_GET['target']) ? escapeshellarg($_GET['target']) : '';
    if (empty($target)) {
        json_output(['status' => 'error', 'message' => 'Missing target VM'], 400);
    }
    $cmd = '';
    if ($action === 'start_vm') $cmd = "virsh start {$target}";
    elseif ($action === 'stop_vm') $cmd = "virsh shutdown {$target}";
    elseif ($action === 'restart_vm') $cmd = "virsh reboot {$target}";
    elseif ($action === 'force_stop_vm') $cmd = "virsh destroy {$target}";
    elseif ($action === 'pause_vm') $cmd = "virsh suspend {$target}";
    elseif ($action === 'resume_vm') $cmd = "virsh resume {$target}";
    
    $out = shell_exec($cmd . ' 2>&1');
    json_output(['status' => 'success', 'message' => "VM action {$action} executed", 'ready_count' => $readyCount,
        'new_version_count' => $newVersionCount,
        'output' => trim($out)
    ]);
}

function handle_parity_control() {
    $cmd = isset($_GET['cmd']) ? trim($_GET['cmd']) : (isset($_POST['cmd']) ? trim($_POST['cmd']) : '');
    if (empty($cmd)) {
        json_output(['status' => 'error', 'message' => 'Missing parity command (cmd)'], 400);
    }
    
    $out = '';
    $msg = '';
    if ($cmd === 'start' || $cmd === 'check') {
        $out = @shell_exec('/usr/local/sbin/mdcmd check 2>&1');
        $msg = '已发起阵列奇偶校验';
    } elseif ($cmd === 'pause') {
        $out = @shell_exec('/usr/local/sbin/mdcmd check pause 2>&1');
        $msg = '已暂停阵列奇偶校验';
    } elseif ($cmd === 'resume') {
        $out = @shell_exec('/usr/local/sbin/mdcmd check resume 2>&1');
        $msg = '已恢复阵列奇偶校验';
    } elseif ($cmd === 'cancel' || $cmd === 'stop') {
        $out = @shell_exec('/usr/local/sbin/mdcmd check cancel 2>&1');
        $msg = '已终止阵列奇偶校验';
    } else {
        json_output(['status' => 'error', 'message' => "Unsupported parity command: {$cmd}"], 400);
    }

    json_output([
        'status' => 'success',
        'message' => $msg,
        'command' => $cmd,
        'ready_count' => $readyCount,
        'new_version_count' => $newVersionCount,
        'output' => trim($out)
    ]);
}

function handle_syslog() {
    $lines = isset($_GET['lines']) ? (int)$_GET['lines'] : 150;
    if ($lines <= 0 || $lines > 1000) $lines = 150;

    $logFile = '/var/log/syslog';
    if (!file_exists($logFile)) {
        $logFile = '/var/log/messages';
    }

    $out = '';
    if (file_exists($logFile)) {
        $out = @shell_exec("tail -n {$lines} " . escapeshellarg($logFile) . " 2>&1");
    } else {
        $out = "系统日志文件未找到 (/var/log/syslog)";
    }

    json_output([
        'status' => 'success',
        'file' => $logFile,
        'lines' => $lines,
        'logs' => $out ?: '暂无系统日志记录'
    ]);
}

function handle_smart_info() {
    $rawTarget = isset($_GET['target']) ? trim($_GET['target']) : '';
    $rawName = isset($_GET['name']) ? trim($_GET['name']) : '';
    if (empty($rawTarget) && empty($rawName)) {
        if (!empty($_GET['disk'])) $rawName = trim($_GET['disk']);
        if (!empty($_GET['device'])) $rawTarget = trim($_GET['device']);
    }
    if (empty($rawTarget) && empty($rawName)) {
        json_output(['status' => 'error', 'message' => 'Missing disk device name'], 400);
    }

    $rawTarget = str_replace('/dev/', '', $rawTarget);
    $targetStr = !empty($rawTarget) ? $rawTarget : $rawName;
    $dev = preg_replace('/[^a-zA-Z0-9_\-]/', '', $targetStr);
    $diskName = preg_replace('/[^a-zA-Z0-9_\-]/', '', $rawName);

    // If target is mdX (Unraid array MD driver), it maps to diskX
    $mdMappedName = '';
    if (preg_match('/^md(\d+)$/', $dev, $m)) {
        $mdMappedName = 'disk' . $m[1];
    }

    // Lookup real physical device from disks.ini
    $uInfo = null;
    $iniFile = '/var/local/emhttp/disks.ini';
    if (file_exists($iniFile)) {
        $ini = @parse_ini_file($iniFile, true);
        if ($ini) {
            foreach ($ini as $sec => $d) {
                $matches = (
                    $sec === $dev ||
                    $sec === $diskName ||
                    $sec === $mdMappedName ||
                    (!empty($d['name']) && ($d['name'] === $dev || $d['name'] === $diskName || $d['name'] === $mdMappedName)) ||
                    (!empty($d['device']) && $d['device'] === $dev)
                );
                if ($matches) {
                    $uInfo = $d;
                    if (!empty($d['device'])) {
                        $dev = $d['device'];
                    }
                    break;
                }
            }
        }
    }

    // If still an md device (e.g. md1), resolve physical backing device via Linux sysfs
    if (strpos($dev, 'md') === 0) {
        $slavesDir = "/sys/block/{$dev}/slaves";
        if (is_dir($slavesDir)) {
            $slaves = @scandir($slavesDir);
            if ($slaves) {
                foreach ($slaves as $s) {
                    if ($s !== '.' && $s !== '..') {
                        $dev = $s;
                        break;
                    }
                }
            }
        }
    }

    // Strip partition numbers (e.g. sda1 -> sda, nvme0n1p1 -> nvme0n1)
    if (preg_match('/^(nvme\d+n\d+)p\d+$/', $dev, $m)) {
        $dev = $m[1];
    } elseif (preg_match('/^(sd[a-z]+)\d+$/', $dev, $m)) {
        $dev = $m[1];
    } elseif (preg_match('/^(hd[a-z]+)\d+$/', $dev, $m)) {
        $dev = $m[1];
    } elseif (preg_match('/^(vd[a-z]+)\d+$/', $dev, $m)) {
        $dev = $m[1];
    }

    $escapedDev = escapeshellarg("/dev/{$dev}");

    // Run smartctl with intelligent fallback flags
    $out = @shell_exec("smartctl -a {$escapedDev} 2>&1");

    // 1. If NVMe device or detection error
    if (strpos($dev, 'nvme') !== false || strpos($out, 'Unable to detect device type') !== false) {
        $nvmeOut = @shell_exec("smartctl -a -d nvme {$escapedDev} 2>&1");
        if ($nvmeOut && strlen($nvmeOut) > strlen($out)) {
            $out = $nvmeOut;
        }
    }
    // 2. If SAT / USB bridge
    if (strpos($out, 'Device does not support SMART') !== false || strpos($out, 'Unknown USB bridge') !== false || strlen(trim($out)) < 200) {
        $satOut = @shell_exec("smartctl -a -d sat {$escapedDev} 2>&1");
        if ($satOut && strlen($satOut) > strlen($out)) {
            $out = $satOut;
        }
    }
    // 3. If standard output misses attributes, try -x
    if (strpos($out, 'START OF READ SMART DATA SECTION') === false && strpos($out, 'SMART/Health Information') === false) {
        $extOut = @shell_exec("smartctl -x {$escapedDev} 2>&1");
        if ($extOut && strlen($extOut) > strlen($out)) {
            $out = $extOut;
        }
    }

    // Check if drive was in STANDBY mode
    $isStandby = (strpos($out, 'STANDBY mode') !== false || strpos($out, 'Device is in SLEEP mode') !== false);
    if ($isStandby) {
        $notice = "【提示】磁盘当前处于待机休眠 (Standby) 状态。\n";
        if ($uInfo) {
            $cachedTemp = isset($uInfo['temp']) ? $uInfo['temp'] : '待机';
            $cachedStatus = isset($uInfo['status']) ? $uInfo['status'] : '正常';
            $notice .= "已从 Unraid 系统缓存载入基本指标（温度: {$cachedTemp} °C, 状态: {$cachedStatus}）。\n如需获取完整最新传感器数据，请唤醒磁盘。\n\n";
        }
        $out = $notice . $out;
    }

    // Parse structured data for UI cards
    $isNvme = (strpos($dev, 'nvme') !== false || strpos($out, 'NVM Subsystem') !== false);
    $parsed = [
        'model' => '',
        'serial' => '',
        'capacity' => '',
        'health' => 'Normal',
        'power_on_hours' => '',
        'temp' => '',
        'reallocated' => '',
        'pending' => '',
        'crc_errors' => '',
        'percentage_used' => '',
        'device_type' => $isNvme ? 'NVMe' : 'SATA/SAS'
    ];

    if (preg_match('/(?:Device Model|Model Number|Product):\s+(.+)/i', $out, $m)) {
        $parsed['model'] = trim($m[1]);
    } elseif ($uInfo && !empty($uInfo['id'])) {
        $parsed['model'] = $uInfo['id'];
    }

    if (preg_match('/Serial Number:\s+(.+)/i', $out, $m)) {
        $parsed['serial'] = trim($m[1]);
    }

    if (preg_match('/(?:User Capacity|Total NVM Capacity):\s+(.+)/i', $out, $m)) {
        $rawCap = trim($m[1]);
        // 1. Prefer bracketed human-readable size e.g. "[4.00 TB]" or "[500 GB]"
        if (preg_match('/\[([0-9\.]+\s*[KMGTPE]?B)\]/i', $rawCap, $bMatch)) {
            $parsed['capacity'] = $bMatch[1];
        } elseif (preg_match('/([\d,]+)\s*(?:bytes|B)?/i', $rawCap, $numMatch)) {
            $bytes = (float)str_replace(',', '', $numMatch[1]);
            if ($bytes >= 1e12) {
                $parsed['capacity'] = round($bytes / 1e12, 2) . ' TB';
            } elseif ($bytes >= 1e9) {
                $parsed['capacity'] = round($bytes / 1e9, 1) . ' GB';
            } elseif ($bytes >= 1e6) {
                $parsed['capacity'] = round($bytes / 1e6, 1) . ' MB';
            } else {
                $parsed['capacity'] = $rawCap;
            }
        } else {
            $parsed['capacity'] = $rawCap;
        }
    } elseif ($uInfo && !empty($uInfo['size'])) {
        $bytes = (float)$uInfo['size'] * 1024;
        if ($bytes >= 1e12) {
            $parsed['capacity'] = round($bytes / 1e12, 2) . ' TB';
        } elseif ($bytes >= 1e9) {
            $parsed['capacity'] = round($bytes / 1e9, 1) . ' GB';
        } else {
            $parsed['capacity'] = round($bytes / 1e6, 1) . ' MB';
        }
    }

    if (preg_match('/(?:SMART overall-health self-assessment test result|SMART Health Status):\s+(.+)/i', $out, $m)) {
        $parsed['health'] = trim($m[1]);
    } elseif ($uInfo && !empty($uInfo['status'])) {
        $parsed['health'] = (stripos($uInfo['status'], 'OK') !== false) ? 'PASSED' : $uInfo['status'];
    }

    if (preg_match('/(?:Power_On_Hours[^\n]*?\s+(\d+)\s*$|Power On Hours:\s+([\d,]+)|Accumulated power on time[^\d]+(\d+))/im', $out, $m)) {
        $parsed['power_on_hours'] = trim(!empty($m[1]) ? $m[1] : (!empty($m[2]) ? $m[2] : $m[3]));
    }

    if (preg_match('/(?:Temperature_Celsius[^\n]*?\s+(\d+)\s*$|Temperature:\s+(\d+)\s*Celsius|Current Drive Temperature:\s+(\d+))/im', $out, $m)) {
        $parsed['temp'] = trim(!empty($m[1]) ? $m[1] : (!empty($m[2]) ? $m[2] : $m[3]));
    } elseif ($uInfo && isset($uInfo['temp']) && is_numeric($uInfo['temp'])) {
        $parsed['temp'] = (string)$uInfo['temp'];
    }

    if (preg_match('/Reallocated_Sector_Ct[^\n]*?\s+(\d+)\s*$/m', $out, $m)) {
        $parsed['reallocated'] = trim($m[1]);
    } elseif (preg_match('/Available Spare:\s+(\d+%)/i', $out, $m)) {
        $parsed['reallocated'] = '可用备用: ' . $m[1];
    }

    if (preg_match('/Current_Pending_Sector[^\n]*?\s+(\d+)\s*$/m', $out, $m)) {
        $parsed['pending'] = trim($m[1]);
    }

    if (preg_match('/UDMA_CRC_Error_Count[^\n]*?\s+(\d+)\s*$/m', $out, $m)) {
        $parsed['crc_errors'] = trim($m[1]);
    }

    if (preg_match('/Percentage Used:\s+(\d+%)/i', $out, $m)) {
        $parsed['percentage_used'] = trim($m[1]);
    }

    json_output([
        'status' => 'success',
        'device' => $dev,
        'data' => $out ?: "未能获取到 /dev/{$dev} 的 S.M.A.R.T. 数据",
        'parsed' => $parsed
    ]);
}

// -------------------------------------------------------------
// FILE SYSTEM OPERATIONS
// -------------------------------------------------------------

function handle_file_list() {
    @header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    @header('Pragma: no-cache');
    $rawPath = isset($_GET['path']) ? $_GET['path'] : ALLOWED_ROOT;
    $targetDir = sanitize_path($rawPath);
    clearstatcache(true, $targetDir);

    if (!file_exists($targetDir)) {
        json_output(['status' => 'error', 'message' => "Directory not found: {$targetDir}"], 404);
    }
    if (!is_dir($targetDir)) {
        json_output(['status' => 'error', 'message' => "Path is not a directory: {$targetDir}"], 400);
    }

    $entries = scandir($targetDir);
    if ($entries === false) {
        json_output(['status' => 'error', 'message' => "Permission denied or failed to open directory"], 403);
    }

    $folders = [];
    $files = [];

    foreach ($entries as $item) {
        if ($item === '.' || $item === '..') continue;
        if ($item === '.DS_Store' || $item === 'Thumbs.db') continue;

        $fullItemPath = rtrim($targetDir, '/') . '/' . $item;
        $isDir = is_dir($fullItemPath);
        $size = 0;
        $mtime = '';
        
        if ($isDir) {
            $mtime = @date('Y-m-d H:i:s', @filemtime($fullItemPath));
            $folders[] = [
                'name' => $item,
                'path' => $fullItemPath,
                'isFolder' => true,
                'size' => 0,
                'mtime' => $mtime ?: '',
                'ext' => ''
            ];
        } else {
            $size = (float)@filesize($fullItemPath);
            $mtime = @date('Y-m-d H:i:s', @filemtime($fullItemPath));
            $ext = strtolower(pathinfo($item, PATHINFO_EXTENSION));
            $files[] = [
                'name' => $item,
                'path' => $fullItemPath,
                'isFolder' => false,
                'size' => $size,
                'mtime' => $mtime ?: '',
                'ext' => $ext
            ];
        }
    }

    usort($folders, function($a, $b) { return strcasecmp($a['name'], $b['name']); });
    usort($files, function($a, $b) { return strcasecmp($a['name'], $b['name']); });

    $isRoot = ($targetDir === ALLOWED_ROOT);
    $parentPath = $isRoot ? ALLOWED_ROOT : dirname($targetDir);

    $parseIniBytes = function($val) {
        $val = trim((string)$val);
        if (empty($val)) return 0;
        $last = strtolower($val[strlen($val) - 1]);
        $num = floatval($val);
        switch ($last) {
            case 'g': $num *= 1024 * 1024 * 1024; break;
            case 'm': $num *= 1024 * 1024; break;
            case 'k': $num *= 1024; break;
        }
        return (int)$num;
    };
    $upMax = $parseIniBytes(ini_get('upload_max_filesize'));
    $postMax = $parseIniBytes(ini_get('post_max_size'));
    $singleLimit = ($upMax > 0 && $postMax > 0) ? min($upMax, $postMax) : ($upMax > 0 ? $upMax : ($postMax > 0 ? $postMax : 16777216));
    $safeDirectLimit = max(0, $singleLimit - 524288);

    json_output([
        'status' => 'success',
        'api_version' => UNRAID_API_VERSION,
        'current_path' => $targetDir,
        'parent_path' => $parentPath,
        'is_root' => $isRoot,
        'csrf_token' => get_system_csrf_token(),
        'max_upload_size' => $safeDirectLimit,
        'items' => array_merge($folders, $files)
    ]);
}

/**
 * High-performance HTTP 206 Partial Content Range streaming & Direct download
 */
function handle_file_stream() {
    $rawPath = isset($_GET['path']) ? $_GET['path'] : '';
    $filePath = sanitize_path($rawPath);

    clearstatcache(true, $filePath);
    if (!file_exists($filePath) || is_dir($filePath)) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo "File not found: " . $filePath;
        exit;
    }

    $filesize = sprintf("%u", filesize($filePath));
    $mimeType = get_mime_type($filePath);
    $filename = safe_basename($filePath);

    // Clean any prior output buffering
    while (ob_get_level()) { ob_end_clean(); }

    header("Content-Type: {$mimeType}");
    header("Accept-Ranges: bytes");
    header("Content-Disposition: inline; filename=\"" . rawurlencode($filename) . "\"");

    // Check for HTTP Range Header
    if (isset($_SERVER['HTTP_RANGE'])) {
        $start = 0;
        $end = $filesize - 1;
        $c_start = $start;
        $c_end = $end;

        list(, $range) = explode('=', $_SERVER['HTTP_RANGE'], 2);
        if (strpos($range, ',') !== false) {
            http_response_code(416);
            header("Content-Range: bytes */{$filesize}");
            exit;
        }

        if ($range[0] === '-') {
            $c_start = $filesize - substr($range, 1);
        } else {
            $range_parts = explode('-', $range);
            $c_start = $range_parts[0];
            $c_end = (isset($range_parts[1]) && is_numeric($range_parts[1])) ? $range_parts[1] : $filesize - 1;
        }

        $c_end = ($c_end > $filesize - 1) ? $filesize - 1 : $c_end;
        if ($c_start > $c_end || $c_start > $filesize - 1 || $c_end >= $filesize) {
            http_response_code(416);
            header("Content-Range: bytes */{$filesize}");
            exit;
        }

        $start = $c_start;
        $end = $c_end;
        $length = $end - $start + 1;

        http_response_code(206);
        header("Content-Range: bytes {$start}-{$end}/{$filesize}");
        header("Content-Length: {$length}");

        $fp = @fopen($filePath, 'rb');
        if ($fp) {
            fseek($fp, $start);
            $bufferSize = 1024 * 64;
            $bytesRemaining = $length;
            while (!feof($fp) && $bytesRemaining > 0 && !connection_aborted()) {
                $readSize = ($bytesRemaining > $bufferSize) ? $bufferSize : $bytesRemaining;
                $buffer = fread($fp, $readSize);
                echo $buffer;
                flush();
                $bytesRemaining -= strlen($buffer);
            }
            fclose($fp);
        }
        exit;
    }

    // Standard Direct Stream (no Range requested)
    header("Content-Length: {$filesize}");
    readfile($filePath);
    exit;
}

function handle_file_read() {
    try {
        $rawPath = isset($_GET['path']) ? $_GET['path'] : '';
        $filePath = sanitize_path($rawPath);

        clearstatcache(true, $filePath);
        if (!file_exists($filePath) || is_dir($filePath)) {
            json_output(['status' => 'error', 'message' => 'File not found: ' . $filePath], 404);
        }

        $size = (float)filesize($filePath);
        if ($size > 50 * 1024 * 1024) { // 50MB safety ceiling
            json_output(['status' => 'error', 'message' => '文件体积过大（超过 50MB），建议直接下载至手机查看'], 400);
        }

        // Default 512KB (524,288 bytes) reads ~250,000 Chinese characters / 20,000+ lines in one shot
        // If max_bytes=0, read until end of file
        $maxBytes = isset($_GET['max_bytes']) ? intval($_GET['max_bytes']) : 524288;
        $offset = isset($_GET['offset']) ? max(0, intval($_GET['offset'])) : 0;

        $fp = @fopen($filePath, 'rb');
        if ($fp === false) {
            json_output(['status' => 'error', 'message' => '读取文件内容失败: 无法打开文件'], 500);
        }

        if ($offset > 0) {
            @fseek($fp, $offset);
        }

        $bytesRemaining = max(0, $size - $offset);
        $readLen = ($maxBytes > 0) ? min($maxBytes, $bytesRemaining) : $bytesRemaining;

        $content = '';
        if ($readLen > 0) {
            $readResult = @fread($fp, (int)$readLen);
            if ($readResult !== false) {
                $content = $readResult;
            }
        }
        @fclose($fp);

        $isTruncated = ($maxBytes > 0 && ($offset + strlen($content)) < $size);

        // Client requested encoding override (e.g. ?encoding=gbk or ?encoding=utf-8)
        $requestedEncoding = isset($_GET['encoding']) ? strtolower(trim($_GET['encoding'])) : '';
        $detectedEncoding = 'UTF-8';

        if ($requestedEncoding === 'gbk' || $requestedEncoding === 'gb2312' || $requestedEncoding === 'gb18030') {
            $converted = safe_convert_encoding($content, 'UTF-8', ['GB18030', 'GBK', 'CP936']);
            if ($converted !== false && strlen($converted) > 0) {
                $content = $converted;
                $detectedEncoding = 'GB18030';
            }
        } elseif ($requestedEncoding === 'big5') {
            $converted = safe_convert_encoding($content, 'UTF-8', ['BIG5']);
            if ($converted !== false && strlen($converted) > 0) {
                $content = $converted;
                $detectedEncoding = 'BIG5';
            }
        } elseif ($requestedEncoding === 'utf-8') {
            if (substr($content, 0, 3) === "\xEF\xBB\xBF") {
                $content = substr($content, 3);
            }
            $detectedEncoding = 'UTF-8';
        } else {
            // Automatic intelligent encoding detection:
            if (substr($content, 0, 3) === "\xEF\xBB\xBF") {
                $content = substr($content, 3);
                $detectedEncoding = 'UTF-8 (BOM)';
            } elseif (substr($content, 0, 2) === "\xFF\xFE") {
                $content = safe_convert_encoding(substr($content, 2), 'UTF-8', ['UTF-16LE']);
                $detectedEncoding = 'UTF-16LE';
            } elseif (substr($content, 0, 2) === "\xFE\xFF") {
                $content = safe_convert_encoding(substr($content, 2), 'UTF-8', ['UTF-16BE']);
                $detectedEncoding = 'UTF-16BE';
            } else {
                // Safety: if string was truncated, test a sub-slice omitting the last 4 bytes to avoid false negatives
                $probe = strlen($content) > 10 ? substr($content, 0, -4) : $content;
                $isUtf8 = function_exists('mb_check_encoding') ? @mb_check_encoding($probe, 'UTF-8') : (preg_match('//u', $probe) === 1);

                if (!$isUtf8) {
                    // Not UTF-8! Try GB18030 / GBK / BIG5 safely
                    $converted = safe_convert_encoding($content, 'UTF-8', ['GB18030', 'GBK', 'CP936', 'BIG5', 'EUC-CN']);
                    if ($converted !== false && strlen($converted) > 0) {
                        $content = $converted;
                        $detectedEncoding = 'GB18030/GBK';
                    }
                } else {
                    $detectedEncoding = 'UTF-8';
                }
            }
        }

        // If string was truncated, remove dangling broken multibyte sequences at the tail
        if ($isTruncated && strlen($content) > 4) {
            for ($i = 0; $i < 4; $i++) {
                $slice = ($i === 0) ? $content : substr($content, 0, -$i);
                if (function_exists('mb_check_encoding') && @mb_check_encoding($slice, 'UTF-8')) {
                    $content = $slice;
                    break;
                }
            }
        }

        // Final scrubbing to guarantee UTF-8 validity
        $content = safe_scrub_utf8($content);

        json_output([
            'status' => 'success',
            'path' => $filePath,
            'name' => safe_basename($filePath),
            'size' => $size,
            'offset' => $offset,
            'truncated' => $isTruncated,
            'preview_size' => strlen($content),
            'encoding' => $detectedEncoding,
            'content' => $content
        ]);
    } catch (Throwable $t) {
        log_upload_debug("handle_file_read error: " . $t->getMessage());
        json_output(['status' => 'error', 'message' => '读取文本异常: ' . $t->getMessage()], 500);
    }
}

function handle_pdf_preview() {
    $rawPath = isset($_GET['path']) ? $_GET['path'] : '';
    $filePath = sanitize_path($rawPath);

    clearstatcache(true, $filePath);
    if (!file_exists($filePath) || is_dir($filePath)) {
        json_output(['status' => 'error', 'message' => 'PDF 文件不存在: ' . $filePath], 404);
    }

    $ext = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
    if ($ext !== 'pdf') {
        json_output(['status' => 'error', 'message' => '目标文件不是 PDF 格式'], 400);
    }

    $hasPdftoppm = (trim((string)@shell_exec('which pdftoppm 2>/dev/null')) !== '');
    $hasGs = (trim((string)@shell_exec('which gs 2>/dev/null')) !== '');
    $hasConvert = (trim((string)@shell_exec('which convert 2>/dev/null')) !== '');
    $hasPdftotext = (trim((string)@shell_exec('which pdftotext 2>/dev/null')) !== '');

    $escaped = escapeshellarg($filePath);
    $pageCount = 0;

    // Detect page count via pdfinfo or pdftotext or gs
    $pdfinfo = @shell_exec("pdfinfo {$escaped} 2>/dev/null");
    if ($pdfinfo && preg_match('/Pages:\s+(\d+)/i', $pdfinfo, $m)) {
        $pageCount = (int)$m[1];
    } elseif ($hasGs) {
        $gsCount = @shell_exec("gs -q -dNODISPLAY -c \"({$escaped}) (r) file runpdfbegin pdfpagecount = quit\" 2>/dev/null");
        if ($gsCount && is_numeric(trim($gsCount))) {
            $pageCount = (int)trim($gsCount);
        }
    }

    // Pure PHP page count fallback if external tools absent
    if ($pageCount <= 0) {
        $fp = @fopen($filePath, 'rb');
        if ($fp) {
            $pdfHead = @fread($fp, 5242880); // Read first 5MB
            @fclose($fp);
            if ($pdfHead) {
                if (preg_match_all('/\/Type\s*\/Page\b/', $pdfHead, $pm)) {
                    $pageCount = count($pm[0]);
                }
                if ($pageCount <= 0 && preg_match('/\/Count\s+(\d+)/', $pdfHead, $cm)) {
                    $pageCount = (int)$cm[1];
                }
            }
        }
    }

    $extractedText = '';
    if ($hasPdftotext) {
        $cmd = "pdftotext -f 1 -l 30 -enc UTF-8 {$escaped} - 2>/dev/null";
        $extractedText = (string)@shell_exec($cmd);
    }

    // Pure PHP text extraction fallback from PDF streams
    if (empty($extractedText)) {
        $fp = @fopen($filePath, 'rb');
        if ($fp) {
            $rawHead = @fread($fp, 2097152); // Read up to 2MB
            @fclose($fp);
            if ($rawHead && preg_match_all('/stream\r?\n(.*?)\r?\nendstream/s', $rawHead, $streamMatches)) {
                $accum = '';
                foreach ($streamMatches[1] as $rawStream) {
                    $decomp = @gzuncompress($rawStream);
                    $streamText = ($decomp !== false) ? $decomp : $rawStream;
                    if (preg_match_all('/\((.*?)\)\s*Tj/s', $streamText, $tjMatches)) {
                        foreach ($tjMatches[1] as $val) {
                            $accum .= str_replace(['\\(', '\\)', '\\\\'], ['(', ')', '\\'], $val) . ' ';
                        }
                    }
                    if (strlen($accum) > 20000) break;
                }
                if (!empty($accum)) {
                    $extractedText = trim($accum);
                }
            }
        }
    }

    $cleanText = trim($extractedText);
    if (function_exists('mb_check_encoding') && !mb_check_encoding($cleanText, 'UTF-8')) {
        $cleanText = @mb_convert_encoding($cleanText, 'UTF-8', 'CP936, GB18030, GBK, BIG5');
    }

    json_output([
        'status' => 'success',
        'has_render_engine' => ($hasPdftoppm || $hasGs || $hasConvert),
        'render_engine' => $hasPdftoppm ? 'pdftoppm' : ($hasGs ? 'ghostscript' : ($hasConvert ? 'imagemagick' : 'none')),
        'has_text' => (!empty($cleanText)),
        'text' => $cleanText,
        'page_count' => max(1, $pageCount),
        'size' => (float)filesize($filePath),
        'name' => safe_basename($filePath),
        'path' => $filePath
    ]);
}

function handle_pdf_page() {
    $rawPath = isset($_GET['path']) ? $_GET['path'] : '';
    $filePath = sanitize_path($rawPath);
    $page = isset($_GET['page']) ? max(1, intval($_GET['page'])) : 1;
    $dpi = isset($_GET['dpi']) ? min(300, max(72, intval($_GET['dpi']))) : 144;

    clearstatcache(true, $filePath);
    if (!file_exists($filePath) || is_dir($filePath)) {
        header("HTTP/1.1 404 Not Found");
        echo "File not found";
        exit;
    }

    $cacheDir = '/tmp/unraid_pdf_cache';
    if (!is_dir($cacheDir)) {
        @mkdir($cacheDir, 0777, true);
    }

    $mtime = filemtime($filePath);
    $fsize = filesize($filePath);
    $hash = md5("{$filePath}_{$mtime}_{$fsize}_{$dpi}");
    $cacheFile = "{$cacheDir}/{$hash}_{$page}.jpg";

    if (file_exists($cacheFile) && filesize($cacheFile) > 0) {
        header('Content-Type: image/jpeg');
        header('Content-Length: ' . filesize($cacheFile));
        header('Cache-Control: public, max-age=86400');
        @readfile($cacheFile);
        exit;
    }

    $escaped = escapeshellarg($filePath);
    $tmpPrefix = "{$cacheDir}/tmp_{$hash}_{$page}";

    // Method 1: pdftoppm (Fastest & standard on Unraid/Slackware poppler)
    $hasPdftoppm = (trim((string)@shell_exec('which pdftoppm 2>/dev/null')) !== '');
    if ($hasPdftoppm) {
        @shell_exec("pdftoppm -jpeg -r {$dpi} -f {$page} -l {$page} {$escaped} {$tmpPrefix} 2>/dev/null");
        $matches = glob("{$tmpPrefix}*.jpg");
        if (!empty($matches) && file_exists($matches[0]) && filesize($matches[0]) > 0) {
            @rename($matches[0], $cacheFile);
            foreach ($matches as $m) { if (file_exists($m)) @unlink($m); }
            header('Content-Type: image/jpeg');
            header('Content-Length: ' . filesize($cacheFile));
            header('Cache-Control: public, max-age=86400');
            @readfile($cacheFile);
            exit;
        }
    }

    // Method 2: Ghostscript (gs)
    $hasGs = (trim((string)@shell_exec('which gs 2>/dev/null')) !== '');
    if ($hasGs) {
        @shell_exec("gs -dNOPAUSE -dBATCH -sDEVICE=jpeg -r{$dpi} -dFirstPage={$page} -dLastPage={$page} -sOutputFile={$cacheFile} {$escaped} 2>/dev/null");
        if (file_exists($cacheFile) && filesize($cacheFile) > 0) {
            header('Content-Type: image/jpeg');
            header('Content-Length: ' . filesize($cacheFile));
            header('Cache-Control: public, max-age=86400');
            @readfile($cacheFile);
            exit;
        }
    }

    // Method 3: ImageMagick (convert / magick)
    $hasConvert = (trim((string)@shell_exec('which convert 2>/dev/null')) !== '');
    if ($hasConvert) {
        $frame = $page - 1;
        @shell_exec("convert -density {$dpi} {$escaped}[{$frame}] -quality 85 {$cacheFile} 2>/dev/null");
        if (file_exists($cacheFile) && filesize($cacheFile) > 0) {
            header('Content-Type: image/jpeg');
            header('Content-Length: ' . filesize($cacheFile));
            header('Cache-Control: public, max-age=86400');
            @readfile($cacheFile);
            exit;
        }
    }

    header("HTTP/1.1 500 Internal Server Error");
    echo "Server does not have a PDF rasterization engine (pdftoppm, gs, convert)";
    exit;
}

function handle_file_write() {
    $rawPath = isset($_GET['path']) ? $_GET['path'] : (isset($_POST['path']) ? $_POST['path'] : '');
    $filePath = sanitize_path($rawPath);

    if (empty($filePath) || is_dir($filePath)) {
        json_output(['status' => 'error', 'message' => 'Invalid file destination path'], 400);
    }

    $content = file_get_contents('php://input');
    if (isset($_POST['content'])) {
        $content = $_POST['content'];
    }

    $dir = dirname($filePath);
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }

    $res = @file_put_contents($filePath, $content);
    if ($res === false) {
        json_output(['status' => 'error', 'message' => 'Failed to write file. Check directory permissions.'], 500);
    }

    json_output([
        'status' => 'success',
        'message' => 'File saved successfully',
        'size' => $res,
        'path' => $filePath
    ]);
}

function handle_file_upload() {
    @set_time_limit(0);
    @ini_set('max_execution_time', '0');
    @ini_set('max_input_time', '0');
    @ini_set('memory_limit', '512M');
    @ignore_user_abort(true);

    // 1. Validate destination path
    $rawPath = isset($_GET['path']) ? $_GET['path'] : (isset($_POST['path']) ? $_POST['path'] : ALLOWED_ROOT);
    $targetDir = sanitize_path($rawPath);
    
    // Prevent uploading directly to Unraid user shares root
    if ($targetDir === '/mnt' || $targetDir === '/mnt/user') {
        json_output([
            'status' => 'error',
            'message' => '无法直接上传到共享根目录 /mnt/user，请先进入具体的共享文件夹（例如 downloads、appdata 等）后再上传。'
        ], 400);
    }

    if (!is_dir($targetDir)) {
        if (!@mkdir($targetDir, 0777, true)) {
            json_output(['status' => 'error', 'message' => "目标目录不存在且无法创建: {$targetDir}"], 500);
        }
        @chmod($targetDir, 0777);
        @chown($targetDir, 'nobody');
        @chgrp($targetDir, 'users');
    }

    // 2. Resolve destination file name
    $filename = isset($_GET['filename']) ? trim($_GET['filename']) : (isset($_POST['filename']) ? trim($_POST['filename']) : '');
    if (stripos($filename, '%') !== false) {
        $filename = rawurldecode($filename);
    }

    $destName = !empty($filename) ? $filename : (!empty($_FILES['file']['name']) ? $_FILES['file']['name'] : ('upload_' . date('Ymd_His')));
    $cleanDestName = safe_basename($destName);
    if (empty($cleanDestName)) {
        $cleanDestName = 'upload_' . date('Ymd_His');
    }
    $destPath = rtrim($targetDir, '/') . '/' . $cleanDestName;

    // 3. Write file data
    $writeSuccess = false;

    if (!empty($_FILES['file'])) {
        $file = $_FILES['file'];
        if ($file['error'] !== UPLOAD_ERR_OK) {
            $errCodes = [
                UPLOAD_ERR_INI_SIZE => '上传文件大小超出了 php.ini 允许的上限 (upload_max_filesize)',
                UPLOAD_ERR_FORM_SIZE => '上传文件大小超出了表单允许的上限 (MAX_FILE_SIZE)',
                UPLOAD_ERR_PARTIAL => '文件仅部分被上传',
                UPLOAD_ERR_NO_FILE => '未找到上传的文件',
                UPLOAD_ERR_NO_TMP_DIR => '缺少临时文件夹',
                UPLOAD_ERR_CANT_WRITE => '写入磁盘失败',
                UPLOAD_ERR_EXTENSION => 'PHP 扩展停止了文件上传'
            ];
            $detail = isset($errCodes[$file['error']]) ? $errCodes[$file['error']] : "错误码: {$file['error']}";
            json_output(['status' => 'error', 'message' => "上传失败: {$detail}"], 400);
        }

        if (@move_uploaded_file($file['tmp_name'], $destPath)) {
            $writeSuccess = true;
        } elseif (@copy($file['tmp_name'], $destPath)) {
            $writeSuccess = true;
            @unlink($file['tmp_name']);
        } else {
            // Buffered stream copy fallback
            $in = @fopen($file['tmp_name'], 'rb');
            $out = @fopen($destPath, 'wb');
            if ($in && $out) {
                while (!feof($in)) {
                    $buf = fread($in, 1048576);
                    if ($buf !== false && strlen($buf) > 0) fwrite($out, $buf);
                }
                fclose($in);
                fclose($out);
                @unlink($file['tmp_name']);
                $writeSuccess = true;
            }
        }
    } else {
        // Direct stream fallback from php://input
        $in = @fopen('php://input', 'rb');
        $out = @fopen($destPath, 'wb');
        if ($in && $out) {
            $bytesWritten = 0;
            while (!feof($in)) {
                $buff = fread($in, 1048576);
                if ($buff === false || $buff === '') break;
                $w = fwrite($out, $buff);
                if ($w === false) break;
                $bytesWritten += $w;
            }
            @fflush($out);
            @fclose($out);
            @fclose($in);
            if ($bytesWritten > 0 || (isset($_GET['size']) && floatval($_GET['size']) === 0.0)) {
                $writeSuccess = true;
            }
        }
    }

    // 4. Verify physical file creation and size
    clearstatcache(true, $destPath);
    clearstatcache(true, $targetDir);

    if (!$writeSuccess || !file_exists($destPath)) {
        @unlink($destPath);
        $err = error_get_last();
        $msg = $err ? $err['message'] : '写入失败或目标磁盘无写权限';
        log_upload_debug("file_upload failed: dest={$destPath}, err={$msg}");
        json_output(['status' => 'error', 'message' => "无法将文件写入目标路径: {$destPath} ({$msg})"], 500);
    }

    $finalSize = (float)@filesize($destPath);
    $expectedSize = isset($_GET['size']) ? floatval($_GET['size']) : (isset($_POST['size']) ? floatval($_POST['size']) : -1);

    if ($finalSize === 0.0 && $expectedSize > 0.0) {
        @unlink($destPath);
        log_upload_debug("file_upload 0-byte: dest={$destPath}, expected={$expectedSize}");
        json_output(['status' => 'error', 'message' => '上传文件大小为 0 字节，可能超出了服务器 Nginx/PHP 的 post_max_size 限制或网络流中断'], 400);
    }

    // 5. Apply standard Unraid permissions (nobody:users 0666)
    @chmod($destPath, 0666);
    if (function_exists('posix_getuid') && @posix_getuid() === 0) {
        @chown($destPath, 'nobody');
        @chgrp($destPath, 'users');
    }
    clearstatcache(true, $destPath);
    clearstatcache(true, $targetDir);

    log_upload_debug("file_upload success: dest={$destPath}, size={$finalSize}");

    json_output([
        'status' => 'success',
        'complete' => true,
        'api_version' => UNRAID_API_VERSION,
        'message' => '文件已成功上传至 Unraid 存储',
        'path' => $destPath,
        'name' => $cleanDestName,
        'size' => $finalSize,
        'mtime' => date('Y-m-d H:i:s', @filemtime($destPath))
    ]);
}

function handle_file_chunk() {
    @set_time_limit(0);
    @ini_set('max_execution_time', '0');
    @ini_set('max_input_time', '0');
    @ini_set('memory_limit', '512M');
    @ignore_user_abort(true);
    try {
        $payload = [];
        $binaryData = '';

        if (!empty($_FILES['chunk']) && $_FILES['chunk']['error'] === UPLOAD_ERR_OK) {
            $payload = $_POST;
            $binaryData = @file_get_contents($_FILES['chunk']['tmp_name']);
            @unlink($_FILES['chunk']['tmp_name']);
        } elseif (!empty($_POST['data'])) {
            $payload = $_POST;
            $binaryData = base64_decode($_POST['data']);
        } elseif (!empty($_GET['data'])) {
            $payload = $_GET;
            $binaryData = base64_decode($_GET['data']);
        } else {
            $rawInput = file_get_contents('php://input');
            if (empty($rawInput) && !empty($GLOBALS['rawGlobalInput'])) {
                $rawInput = $GLOBALS['rawGlobalInput'];
            }
            $payload = json_decode($rawInput, true);
            if (is_array($payload)) {
                $base64Data = isset($payload['data']) ? $payload['data'] : '';
                $binaryData = ($base64Data !== '') ? base64_decode($base64Data) : '';
                log_upload_debug("chunk_mode: json_base64, rawLen=" . strlen((string)$rawInput) . " binLen=" . strlen($binaryData));
            } else {
                $payload = array_merge($_GET, $_POST);
                if (!empty($_GET['is_base64']) || !empty($_POST['is_base64']) || !empty($_SERVER['HTTP_X_BASE64'])) {
                    $binaryData = base64_decode($rawInput);
                    log_upload_debug("chunk_mode: raw_base64_stream, rawLen=" . strlen((string)$rawInput) . " binLen=" . strlen($binaryData));
                } else {
                    $binaryData = $rawInput;
                    log_upload_debug("chunk_mode: raw_binary_stream, len=" . strlen($binaryData));
                }
            }
        }

        $rawPath = isset($_SERVER['HTTP_X_CHUNK_PATH']) ? rawurldecode($_SERVER['HTTP_X_CHUNK_PATH']) : (isset($payload['path']) ? $payload['path'] : (isset($_POST['path']) ? $_POST['path'] : (isset($_GET['path']) ? $_GET['path'] : ALLOWED_ROOT)));
        $targetDir = sanitize_path($rawPath);

        if ($targetDir === '/mnt' || $targetDir === '/mnt/user') {
            log_upload_debug("chunk_err: direct root target {$targetDir}");
            json_output([
                'status' => 'error',
                'message' => '无法直接上传到共享根目录 /mnt/user，请先点击进入具体的共享文件夹（例如 downloads、appdata 等）后再上传。'
            ], 400);
        }

        if (!is_dir($targetDir)) {
            if (!@mkdir($targetDir, 0777, true)) {
                log_upload_debug("chunk_err: cannot create dir {$targetDir}");
                json_output(['status' => 'error', 'message' => "目标目录不存在且无法创建: {$targetDir}"], 500);
            }
            @chmod($targetDir, 0777);
            if (function_exists('posix_getuid') && @posix_getuid() === 0) {
                @chown($targetDir, 'nobody');
                @chgrp($targetDir, 'users');
            }
        }

        $filename = isset($_SERVER['HTTP_X_CHUNK_FILENAME']) ? rawurldecode($_SERVER['HTTP_X_CHUNK_FILENAME']) : (isset($payload['filename']) ? trim($payload['filename']) : (isset($_POST['filename']) ? trim($_POST['filename']) : (isset($_GET['filename']) ? trim($_GET['filename']) : '')));
        if (stripos($filename, '%') !== false) {
            $filename = rawurldecode($filename);
        }
        $cleanName = safe_basename($filename);
        if (empty($cleanName)) {
            log_upload_debug("chunk_err: empty filename");
            json_output(['status' => 'error', 'message' => '文件名不能为空'], 400);
        }

        $destPath = rtrim($targetDir, '/') . '/' . $cleanName;
        $chunkIndex = isset($_SERVER['HTTP_X_CHUNK_INDEX']) ? intval($_SERVER['HTTP_X_CHUNK_INDEX']) : (isset($payload['chunk_index']) ? intval($payload['chunk_index']) : (isset($_POST['chunk_index']) ? intval($_POST['chunk_index']) : (isset($_GET['chunk_index']) ? intval($_GET['chunk_index']) : 0)));
        $totalChunks = isset($_SERVER['HTTP_X_CHUNK_TOTAL']) ? intval($_SERVER['HTTP_X_CHUNK_TOTAL']) : (isset($payload['total_chunks']) ? intval($payload['total_chunks']) : (isset($_POST['total_chunks']) ? intval($_POST['total_chunks']) : (isset($_GET['total_chunks']) ? intval($_GET['total_chunks']) : 1)));
        $offset = isset($_SERVER['HTTP_X_CHUNK_OFFSET']) ? floatval($_SERVER['HTTP_X_CHUNK_OFFSET']) : (isset($payload['offset']) ? floatval($payload['offset']) : (isset($_POST['offset']) ? floatval($_POST['offset']) : (isset($_GET['offset']) ? floatval($_GET['offset']) : 0)));
        $totalSize = isset($_SERVER['HTTP_X_CHUNK_SIZE']) ? floatval($_SERVER['HTTP_X_CHUNK_SIZE']) : (isset($payload['total_size']) ? floatval($payload['total_size']) : (isset($_POST['total_size']) ? floatval($_POST['total_size']) : (isset($_GET['total_size']) ? floatval($_GET['total_size']) : 0)));

        // First chunk creates/truncates the file, subsequent chunks append/seek
        $fp = false;
        if ($chunkIndex === 0 && $offset == 0) {
            $fp = @fopen($destPath, 'wb');
        } else {
            $fp = @fopen($destPath, 'c+b');
            if (!$fp && file_exists($destPath)) {
                $fp = @fopen($destPath, 'r+b');
            }
            if (!$fp) {
                $fp = @fopen($destPath, 'ab');
            }
        }

        if (!$fp) {
            $err = error_get_last();
            $msg = $err ? $err['message'] : '无法打开或创建目标文件';
            log_upload_debug("chunk_err: fopen failed for {$destPath}: {$msg}");
            json_output(['status' => 'error', 'message' => "无法打开或创建目标文件: {$destPath} ({$msg})"], 500);
        }

        if ($offset > 0) {
            @fseek($fp, (int)$offset);
        }

        $written = 0;
        if (strlen($binaryData) > 0) {
            $written = @fwrite($fp, $binaryData);
        }
        @fclose($fp);

        if (strlen($binaryData) > 0 && ($written === false || $written !== strlen($binaryData))) {
            log_upload_debug("chunk_err: write partial for {$destPath}, expected=" . strlen($binaryData) . " wrote={$written}");
            json_output(['status' => 'error', 'message' => "分片写入失败，目标磁盘可能空间不足。"], 500);
        }

        $isComplete = ($chunkIndex + 1 >= $totalChunks);
        if ($chunkIndex === 0 || $isComplete) {
            @chmod($destPath, 0666);
            if (function_exists('posix_getuid') && @posix_getuid() === 0) {
                @chown($destPath, 'nobody');
                @chgrp($destPath, 'users');
            }
            clearstatcache(true, $destPath);
            clearstatcache(true, $targetDir);
            $currentSize = @filesize($destPath);
        } else {
            $currentSize = (float)($offset + $written);
        }

        if ($chunkIndex === 0 || $chunkIndex % 10 === 0 || $isComplete) {
            log_upload_debug("chunk_ok: file={$cleanName} chunk={$chunkIndex}/{$totalChunks} written={$written} curSize={$currentSize} complete=" . ($isComplete ? '1' : '0'));
        }

        if ($isComplete) {
            json_output([
                'status' => 'success',
                'api_version' => UNRAID_API_VERSION,
                'complete' => true,
                'message' => '文件已成功写入 Unraid 存储',
                'path' => $destPath,
                'name' => $cleanName,
                'size' => $currentSize,
                'total_size' => $totalSize
            ]);
        } else {
            json_output([
                'status' => 'success',
                'api_version' => UNRAID_API_VERSION,
                'complete' => false,
                'chunk_index' => $chunkIndex,
                'total_chunks' => $totalChunks,
                'bytes_written' => $written,
                'current_size' => $currentSize
            ]);
        }
    } catch (\Throwable $e) {
        log_upload_debug("chunk_exception: " . $e->getMessage() . " in " . basename($e->getFile()) . ":" . $e->getLine());
        json_output([
            'status' => 'error',
            'api_version' => UNRAID_API_VERSION,
            'message' => '分片处理异常: ' . $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ')'
        ], 500);
    }
}

function handle_upload_debug() {
    $path = get_debug_log_path();
    $logContent = '';
    $usedPath = $path;
    if (@file_exists($path)) {
        $raw = @file_get_contents($path);
        if (!empty($raw)) {
            $lines = explode("\n", trim($raw));
            $logContent = implode("\n", array_slice($lines, -40));
        }
    }
    if (empty($logContent)) {
        $logContent = 'No upload log recorded yet.';
    }

    $tmpDir = sys_get_temp_dir();
    $tmpWritable = @is_writable($tmpDir);
    $emhttpWritable = @is_writable('/var/local/emhttp');
    $curUser = (function_exists('posix_getpwuid') && function_exists('posix_geteuid')) ? @posix_getpwuid(posix_geteuid())['name'] : 'unknown';

    $nginxErr = '';
    if (@file_exists('/var/log/nginx/error.log')) {
        $nRaw = @file_get_contents('/var/log/nginx/error.log');
        if (!empty($nRaw)) {
            $nLines = explode("\n", trim($nRaw));
            $nginxErr = implode(" | ", array_slice($nLines, -6));
        }
    }

    json_output([
        'status' => 'success',
        'api_version' => UNRAID_API_VERSION,
        'version' => UNRAID_API_VERSION,
        'log' => $logContent,
        'nginx_err' => $nginxErr,
        'log_file' => $usedPath ?: 'none',
        'php_version' => PHP_VERSION,
        'php_sapi' => php_sapi_name(),
        'open_basedir' => ini_get('open_basedir') ?: 'none',
        'post_max_size' => ini_get('post_max_size'),
        'upload_max_filesize' => ini_get('upload_max_filesize'),
        'memory_limit' => ini_get('memory_limit'),
        'tmp_dir' => $tmpDir,
        'tmp_writable' => $tmpWritable ? 'yes' : 'no',
        'emhttp_writable' => $emhttpWritable ? 'yes' : 'no',
        'current_user' => $curUser,
        'csrf_token_found' => get_system_csrf_token() ? 'yes' : 'no'
    ]);
}

function handle_file_mkdir() {
    $targetDir = sanitize_path(isset($_GET['path']) ? $_GET['path'] : (isset($_POST['path']) ? $_POST['path'] : ALLOWED_ROOT));
    $name = isset($_GET['name']) ? trim($_GET['name']) : (isset($_POST['name']) ? trim($_POST['name']) : '');

    if (empty($name) || strpos($name, '/') !== false || strpos($name, '\\') !== false) {
        json_output(['status' => 'error', 'message' => 'Invalid folder name'], 400);
    }

    $newDir = rtrim($targetDir, '/') . '/' . $name;
    if (file_exists($newDir)) {
        json_output(['status' => 'error', 'message' => 'Folder already exists'], 400);
    }

    if (!@mkdir($newDir, 0777, true)) {
        json_output(['status' => 'error', 'message' => 'Failed to create directory'], 500);
    }

    @chmod($newDir, 0777);
    @chown($newDir, 'nobody');
    @chgrp($newDir, 'users');

    json_output(['status' => 'success', 'message' => 'Folder created', 'path' => $newDir]);
}

function handle_file_rename() {
    $oldPath = sanitize_path(isset($_GET['path']) ? $_GET['path'] : (isset($_POST['path']) ? $_POST['path'] : ''));
    $newName = isset($_GET['new_name']) ? trim($_GET['new_name']) : (isset($_POST['new_name']) ? trim($_POST['new_name']) : '');

    if (!file_exists($oldPath)) {
        json_output(['status' => 'error', 'message' => 'Target item not found'], 404);
    }
    if (empty($newName) || strpos($newName, '/') !== false || strpos($newName, '\\') !== false) {
        json_output(['status' => 'error', 'message' => 'Invalid new name'], 400);
    }

    $newPath = dirname($oldPath) . '/' . $newName;
    if (file_exists($newPath)) {
        json_output(['status' => 'error', 'message' => 'Destination item already exists'], 400);
    }

    if (!@rename($oldPath, $newPath)) {
        json_output(['status' => 'error', 'message' => 'Failed to rename item'], 500);
    }

    json_output(['status' => 'success', 'message' => 'Renamed successfully', 'new_path' => $newPath]);
}

function handle_file_delete() {
    $targetPath = sanitize_path(isset($_GET['path']) ? $_GET['path'] : (isset($_POST['path']) ? $_POST['path'] : ''));

    if ($targetPath === ALLOWED_ROOT || empty($targetPath) || !file_exists($targetPath)) {
        json_output(['status' => 'error', 'message' => 'Cannot delete root or non-existent path'], 400);
    }

    $deleteSuccess = false;
    if (is_dir($targetPath)) {
        $cmd = "rm -rf " . escapeshellarg($targetPath);
        exec($cmd, $out, $ret);
        $deleteSuccess = ($ret === 0);
    } else {
        $deleteSuccess = @unlink($targetPath);
    }

    if (!$deleteSuccess) {
        json_output(['status' => 'error', 'message' => 'Failed to delete item'], 500);
    }

    json_output(['status' => 'success', 'message' => 'Item deleted', 'path' => $targetPath]);
}

function handle_file_move() {
    $source = sanitize_path(isset($_GET['source']) ? $_GET['source'] : (isset($_POST['source']) ? $_POST['source'] : ''));
    $targetDir = sanitize_path(isset($_GET['target']) ? $_GET['target'] : (isset($_POST['target']) ? $_POST['target'] : ''));

    if (!file_exists($source) || !is_dir($targetDir)) {
        json_output(['status' => 'error', 'message' => 'Source does not exist or target is not a directory'], 400);
    }

    $destPath = rtrim($targetDir, '/') . '/' . safe_basename($source);
    if (!@rename($source, $destPath)) {
        json_output(['status' => 'error', 'message' => 'Failed to move item'], 500);
    }

    json_output(['status' => 'success', 'message' => 'Item moved', 'new_path' => $destPath]);
}

function handle_file_copy() {
    $source = sanitize_path(isset($_GET['source']) ? $_GET['source'] : (isset($_POST['source']) ? $_POST['source'] : ''));
    $targetDir = sanitize_path(isset($_GET['target']) ? $_GET['target'] : (isset($_POST['target']) ? $_POST['target'] : ''));

    if (!file_exists($source) || !is_dir($targetDir)) {
        json_output(['status' => 'error', 'message' => 'Source does not exist or target is not a directory'], 400);
    }

    $cmd = "cp -r " . escapeshellarg($source) . " " . escapeshellarg($targetDir . '/');
    exec($cmd, $out, $ret);
    if ($ret !== 0) {
        json_output(['status' => 'error', 'message' => 'Failed to copy item'], 500);
    }

    json_output(['status' => 'success', 'message' => 'Item copied', 'target' => $targetDir]);
}

function handle_file_extract() {
    $rawInput = @file_get_contents('php://input');
    $jsonInput = !empty($rawInput) ? @json_decode($rawInput, true) : null;

    $source = sanitize_path(isset($jsonInput['source']) ? $jsonInput['source'] : (isset($_GET['source']) ? $_GET['source'] : (isset($_POST['source']) ? $_POST['source'] : '')));
    $targetDir = sanitize_path(isset($jsonInput['target']) ? $jsonInput['target'] : (isset($_GET['target']) ? $_GET['target'] : (isset($_POST['target']) ? $_POST['target'] : '')));
    $createFolder = isset($jsonInput['create_folder']) ? $jsonInput['create_folder'] : (isset($_GET['create_folder']) ? $_GET['create_folder'] : (isset($_POST['create_folder']) ? $_POST['create_folder'] : 'false'));
    $createFolder = ($createFolder === 'true' || $createFolder === true || $createFolder === '1' || $createFolder === 1);

    if (!file_exists($source) || is_dir($source)) {
        json_output(['status' => 'error', 'message' => '压缩包文件不存在或为目录'], 400);
    }

    if (empty($targetDir)) {
        $targetDir = dirname($source);
    }

    if (!file_exists($targetDir)) {
        @mkdir($targetDir, 0755, true);
    }

    if (!is_dir($targetDir)) {
        json_output(['status' => 'error', 'message' => '目标解压路径无效'], 400);
    }

    $baseName = safe_basename($source);
    // If createFolder is requested, create a subfolder with the archive base name (minus extension)
    if ($createFolder) {
        $folderName = preg_replace('/\.(zip|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar|7z|rar)$/i', '', $baseName);
        if (empty($folderName)) {
            $folderName = $baseName . '_extracted';
        }
        $targetDir = rtrim($targetDir, '/') . '/' . $folderName;
        if (!file_exists($targetDir)) {
            if (!@mkdir($targetDir, 0755, true)) {
                json_output(['status' => 'error', 'message' => '无法创建解压子目录'], 500);
            }
        }
    }

    $lower = strtolower($baseName);
    $cmd = '';

    if (substr($lower, -4) === '.zip') {
        $cmd = "unzip -o -q " . escapeshellarg($source) . " -d " . escapeshellarg($targetDir);
    } elseif (substr($lower, -7) === '.tar.gz' || substr($lower, -4) === '.tgz') {
        $cmd = "tar -zxf " . escapeshellarg($source) . " -C " . escapeshellarg($targetDir);
    } elseif (substr($lower, -8) === '.tar.bz2' || substr($lower, -5) === '.tbz2') {
        $cmd = "tar -jxf " . escapeshellarg($source) . " -C " . escapeshellarg($targetDir);
    } elseif (substr($lower, -7) === '.tar.xz' || substr($lower, -4) === '.txz') {
        $cmd = "tar -Jxf " . escapeshellarg($source) . " -C " . escapeshellarg($targetDir);
    } elseif (substr($lower, -4) === '.tar') {
        $cmd = "tar -xf " . escapeshellarg($source) . " -C " . escapeshellarg($targetDir);
    } elseif (substr($lower, -3) === '.7z') {
        $cmd = "7z x -y -o" . escapeshellarg($targetDir) . " " . escapeshellarg($source);
    } elseif (substr($lower, -4) === '.rar') {
        $cmd = "unrar x -o+ " . escapeshellarg($source) . " " . escapeshellarg($targetDir . '/');
    } else {
        $cmd = "unzip -o -q " . escapeshellarg($source) . " -d " . escapeshellarg($targetDir);
    }

    exec($cmd . " 2>&1", $out, $ret);
    if ($ret !== 0 && substr($lower, -4) === '.zip' && class_exists('ZipArchive')) {
        $zip = new ZipArchive();
        if ($zip->open($source) === true) {
            $zip->extractTo($targetDir);
            $zip->close();
            $ret = 0;
        }
    }

    if ($ret !== 0) {
        $errMsg = !empty($out) ? implode("\n", array_slice($out, -3)) : '解压失败，请确认服务端安装了对应解压工具 (unzip/tar/7z)';
        json_output(['status' => 'error', 'message' => $errMsg], 500);
    }

    json_output([
        'status' => 'success',
        'message' => '解压完成',
        'source' => $source,
        'target' => $targetDir
    ]);
}

function handle_file_compress() {
    @set_time_limit(0);
    @ini_set('max_execution_time', '0');
    @ignore_user_abort(true);
    global $globalJsonInput;
    $rawInput = @file_get_contents('php://input');
    $jsonInput = !empty($rawInput) ? @json_decode($rawInput, true) : $globalJsonInput;

    $rawSources = isset($jsonInput['sources']) ? $jsonInput['sources'] : (isset($_POST['sources']) ? $_POST['sources'] : (isset($_GET['sources']) ? $_GET['sources'] : ''));
    $targetDir = sanitize_path(isset($jsonInput['target_dir']) ? $jsonInput['target_dir'] : (isset($_POST['target_dir']) ? $_POST['target_dir'] : (isset($_GET['target_dir']) ? $_GET['target_dir'] : '')));
    $zipName = isset($jsonInput['zip_name']) ? trim($jsonInput['zip_name']) : (isset($_POST['zip_name']) ? trim($_POST['zip_name']) : (isset($_GET['zip_name']) ? trim($_GET['zip_name']) : ''));

    if (empty($rawSources)) {
        json_output(['status' => 'error', 'message' => '未指定需要打包的文件或目录'], 400);
    }

    $sourcesList = is_array($rawSources) ? $rawSources : json_decode($rawSources, true);
    if (!is_array($sourcesList)) {
        $sourcesList = explode(',', $rawSources);
    }

    $validSources = [];
    foreach ($sourcesList as $s) {
        $p = sanitize_path(trim($s));
        if (file_exists($p)) {
            $validSources[] = $p;
        }
    }

    if (empty($validSources)) {
        json_output(['status' => 'error', 'message' => '所选文件或目录均不存在'], 400);
    }

    if (empty($targetDir)) {
        $targetDir = dirname($validSources[0]);
    }

    if (!file_exists($targetDir) || !is_dir($targetDir)) {
        json_output(['status' => 'error', 'message' => '目标输出目录不存在'], 400);
    }

    if (empty($zipName)) {
        if (count($validSources) === 1) {
            $zipName = safe_basename($validSources[0]) . '.zip';
        } else {
            $zipName = 'Archive_' . date('Ymd_His') . '.zip';
        }
    }

    if (substr(strtolower($zipName), -4) !== '.zip') {
        $zipName .= '.zip';
    }

    $zipName = preg_replace('/[\\\\\/:\*\?"<>\|]/', '_', $zipName);
    $outZipPath = rtrim($targetDir, '/') . '/' . $zipName;

    $commonParent = $targetDir;
    $relArgs = [];
    foreach ($validSources as $src) {
        if (strpos($src, $commonParent . '/') === 0) {
            $relArgs[] = escapeshellarg(substr($src, strlen($commonParent) + 1));
        } else {
            $relArgs[] = escapeshellarg($src);
        }
    }

    // Use -1 for fastest compression level (3x~5x faster than default -6 with standard zip compatibility)
    $cmd = "cd " . escapeshellarg($commonParent) . " && zip -1 -r -q " . escapeshellarg($outZipPath) . " " . implode(' ', $relArgs);
    exec($cmd . " 2>&1", $out, $ret);

    if ($ret !== 0) {
        // Fallback 1: Python 3 zipfile module (standard in Unraid 6.9+)
        $pyCmd = "cd " . escapeshellarg($commonParent) . " && python3 -m zipfile -c " . escapeshellarg($outZipPath) . " " . implode(' ', $relArgs);
        @exec($pyCmd . " 2>&1", $pyOut, $pyRet);
        if ($pyRet === 0 && file_exists($outZipPath) && filesize($outZipPath) > 0) {
            $ret = 0;
        }
    }

    if ($ret !== 0) {
        // Fallback 2: PHP's built-in ZipArchive if zip CLI is missing or failed
        if (class_exists('ZipArchive')) {
            try {
                $zip = new ZipArchive();
                if ($zip->open($outZipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true) {
                    foreach ($validSources as $src) {
                        if (is_dir($src)) {
                            $files = new RecursiveIteratorIterator(
                                new RecursiveDirectoryIterator($src, RecursiveDirectoryIterator::SKIP_DOTS),
                                RecursiveIteratorIterator::SELF_FIRST
                            );
                            $baseDir = dirname($src);
                            foreach ($files as $file) {
                                $filePath = $file->getRealPath();
                                $relativePath = substr($filePath, strlen($baseDir) + 1);
                                if ($file->isDir()) {
                                    $zip->addEmptyDir($relativePath);
                                } else {
                                    $zip->addFile($filePath, $relativePath);
                                }
                            }
                        } else {
                            $zip->addFile($src, safe_basename($src));
                        }
                    }
                    $zip->close();
                    if (file_exists($outZipPath) && filesize($outZipPath) > 0) {
                        $ret = 0;
                    }
                }
            } catch (Throwable $zErr) {
                log_upload_debug("ZipArchive error: " . $zErr->getMessage());
            }
        }
    }

    if ($ret !== 0) {
        $errMsg = !empty($out) ? implode("\n", array_slice($out, -3)) : '服务端打包 Zip 失败，请检查磁盘空间或安装 zip 工具/插件';
        json_output(['status' => 'error', 'message' => $errMsg], 500);
    }

    json_output([
        'status' => 'success',
        'message' => '打包压缩完成',
        'zip_path' => $outZipPath,
        'zip_name' => $zipName
    ]);
}


// -------------------------------------------------------------
// ENHANCED HARDWARE & APPLICATION HELPERS
// -------------------------------------------------------------

function get_disk_io_stats() {
    $stats = [];
    $raw = @file_get_contents('/proc/diskstats');
    if ($raw) {
        foreach (explode("\n", trim($raw)) as $line) {
            $cols = preg_split('/\s+/', trim($line));
            if (count($cols) >= 14) {
                $dev = $cols[2];
                if (preg_match('/^(loop|ram|sr)/', $dev)) continue;
                $sectorsRead = (float)$cols[5];
                $sectorsWritten = (float)$cols[9];
                $stats[$dev] = [
                    'read_bytes' => $sectorsRead * 512,
                    'write_bytes' => $sectorsWritten * 512,
                ];
            }
        }
    }
    return $stats;
}

function get_gpu_telemetry() {
    $gpuData = [
        'name' => '未配置独立显卡',
        'vendor' => 'N/A',
        'usage' => 0,
        'temp' => null,
        'vram_used' => null,
        'vram_total' => null,
        'vram_pct' => 0,
        'power_w' => null,
        'clock_mhz' => null,
        'max_clock_mhz' => null,
        'driver' => 'N/A'
    ];

    $gpustatCand = null;

    // 1. Check Unraid GPU Statistics plugin (gpustatus.php / gpustatusmulti.php)
    // CRITICAL: In Unraid, gpustatus.php outputs live JSON metrics directly to STDOUT!
    $gpustatScripts = [
        '/usr/local/emhttp/plugins/gpustat/gpustatus.php',
        '/usr/local/emhttp/plugins/gpustat/gpustatusmulti.php',
        '/usr/local/emhttp/plugins/gpustat/gpustatusmoveablemulti.php',
        '/usr/local/emhttp/plugins/gpustat/scripts/gpustat.php',
    ];

    $gpustatRaw = null;
    foreach ($gpustatScripts as $script) {
        if (file_exists($script)) {
            $dir = dirname($script);
            $base = basename($script);
            $rawOut = @shell_exec("cd " . escapeshellarg($dir) . " && php " . escapeshellarg($base) . " 2>/dev/null");
            if (!empty($rawOut) && (strpos($rawOut, '{') !== false || strpos($rawOut, '[') !== false)) {
                $gpustatRaw = $rawOut;
                break;
            }
        }
    }

    // Fallback: check /tmp/gpustat*.json if direct script output was empty
    if (empty($gpustatRaw)) {
        $tmpFiles = glob('/tmp/gpustat*.json');
        if (!empty($tmpFiles)) {
            foreach ($tmpFiles as $tf) {
                if (file_exists($tf)) {
                    $c = @file_get_contents($tf);
                    if (!empty($c) && (strpos($c, '{') !== false || strpos($c, '[') !== false)) {
                        $gpustatRaw = $c;
                        break;
                    }
                }
            }
        }
    }

    if (!empty($gpustatRaw)) {
        if (preg_match('/(\[[\s\S]*\]|\{[\s\S]*\})/s', trim($gpustatRaw), $m)) {
            $parsed = @json_decode($m[1], true);
            if (is_array($parsed) && !empty($parsed)) {
                $firstGpu = isset($parsed[0]) ? $parsed[0] : (isset($parsed['gpus'][0]) ? $parsed['gpus'][0] : $parsed);
                if (is_array($firstGpu)) {
                    $mName = !empty($firstGpu['model']) ? $firstGpu['model'] : (!empty($firstGpu['name']) ? $firstGpu['name'] : '');
                    if (!empty($mName) || !empty($firstGpu['vendor'])) {
                        $gName = !empty($mName) ? $mName : 'GPU';
                        $gVendor = !empty($firstGpu['vendor']) ? $firstGpu['vendor'] : (stripos($gName, 'NVIDIA') !== false ? 'NVIDIA' : (stripos($gName, 'Intel') !== false ? 'Intel' : 'AMD'));

                        // Extract usage from any supported key
                        $uVal = null;
                        foreach (['util', 'gpu', 'usage', 'load', '3drender', 'render', 'utilization'] as $k) {
                            if (isset($firstGpu[$k]) && $firstGpu[$k] !== '' && $firstGpu[$k] !== 'N/A') {
                                $clean = preg_replace('/[^0-9.]/', '', (string)$firstGpu[$k]);
                                if ($clean !== '') {
                                    $uVal = (float)$clean;
                                    break;
                                }
                            }
                        }

                        // Extract temperature
                        $tVal = null;
                        foreach (['temp', 'temperature'] as $k) {
                            if (isset($firstGpu[$k]) && $firstGpu[$k] !== '' && $firstGpu[$k] !== 'N/A') {
                                $clean = preg_replace('/[^0-9]/', '', (string)$firstGpu[$k]);
                                if ($clean !== '') {
                                    $tVal = (int)$clean;
                                    break;
                                }
                            }
                        }

                        // Extract clock
                        $cVal = null;
                        foreach (['clock', 'cur_clock', 'clock_mhz'] as $k) {
                            if (isset($firstGpu[$k]) && $firstGpu[$k] !== '' && $firstGpu[$k] !== 'N/A') {
                                $clean = preg_replace('/[^0-9]/', '', (string)$firstGpu[$k]);
                                if ($clean !== '') {
                                    $cVal = (int)$clean;
                                    break;
                                }
                            }
                        }
                        $maxCVal = null;
                        foreach (['clockmax', 'max_clock', 'max_clock_mhz'] as $k) {
                            if (isset($firstGpu[$k]) && $firstGpu[$k] !== '' && $firstGpu[$k] !== 'N/A') {
                                $clean = preg_replace('/[^0-9]/', '', (string)$firstGpu[$k]);
                                if ($clean !== '') {
                                    $maxCVal = (int)$clean;
                                    break;
                                }
                            }
                        }

                        // Extract power
                        $pVal = null;
                        foreach (['power', 'power_w', 'power_draw'] as $k) {
                            if (isset($firstGpu[$k]) && $firstGpu[$k] !== '' && $firstGpu[$k] !== 'N/A') {
                                $clean = preg_replace('/[^0-9.]/', '', (string)$firstGpu[$k]);
                                if ($clean !== '') {
                                    $pVal = (float)$clean;
                                    break;
                                }
                            }
                        }

                        // Extract VRAM
                        $vUsed = null;
                        $vTotal = null;
                        $vPct = 0;
                        if (isset($firstGpu['memused']) && $firstGpu['memused'] !== '' && $firstGpu['memused'] !== 'N/A') {
                            $vUsed = (int)preg_replace('/[^0-9]/', '', (string)$firstGpu['memused']);
                        }
                        if (isset($firstGpu['memtotal']) && $firstGpu['memtotal'] !== '' && $firstGpu['memtotal'] !== 'N/A') {
                            $vTotal = (int)preg_replace('/[^0-9]/', '', (string)$firstGpu['memtotal']);
                        }
                        if ($vUsed !== null && $vTotal !== null && $vTotal > 0) {
                            $vPct = round(($vUsed / $vTotal) * 100, 1);
                        } elseif (isset($firstGpu['memutil']) && $firstGpu['memutil'] !== '' && $firstGpu['memutil'] !== 'N/A') {
                            $cleanMem = preg_replace('/[^0-9.]/', '', (string)$firstGpu['memutil']);
                            if ($cleanMem !== '') $vPct = (float)$cleanMem;
                        }

                        $gpustatCand = [
                            'name' => $gName,
                            'vendor' => $gVendor,
                            'usage' => ($uVal !== null) ? max(0, min(100, $uVal)) : 0,
                            'temp' => $tVal,
                            'vram_used' => $vUsed,
                            'vram_total' => $vTotal,
                            'vram_pct' => $vPct,
                            'power_w' => $pVal,
                            'clock_mhz' => $cVal,
                            'max_clock_mhz' => $maxCVal,
                            'driver' => 'gpustat'
                        ];
                    }
                }
            }
        }
    }

    // 2. Check NVIDIA GPU via nvidia-smi (live query)
    $nvidiaOut = @shell_exec('nvidia-smi --query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,clocks.current.graphics,clocks.max.graphics --format=csv,noheader,nounits 2>/dev/null');
    if (empty($nvidiaOut)) {
        $nvidiaOut = @shell_exec('/usr/local/bin/nvidia-smi --query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,clocks.current.graphics,clocks.max.graphics --format=csv,noheader,nounits 2>/dev/null');
    }
    if ($nvidiaOut && trim($nvidiaOut) !== '') {
        $lines = explode("\n", trim($nvidiaOut));
        if (!empty($lines[0])) {
            $parts = array_map('trim', explode(',', $lines[0]));
            if (count($parts) >= 2 && !empty($parts[0])) {
                $gpuData['name'] = $parts[0];
                $gpuData['vendor'] = 'NVIDIA';
                $gpuData['usage'] = isset($parts[1]) ? (float)$parts[1] : 0;
                $gpuData['temp'] = (isset($parts[2]) && is_numeric($parts[2])) ? (int)$parts[2] : null;
                $vUsed = (isset($parts[3]) && is_numeric($parts[3])) ? (float)$parts[3] : 0;
                $vTotal = (isset($parts[4]) && is_numeric($parts[4])) ? (float)$parts[4] : 0;
                if ($vTotal > 0) {
                    $gpuData['vram_used'] = (int)$vUsed;
                    $gpuData['vram_total'] = (int)$vTotal;
                    $gpuData['vram_pct'] = round(($vUsed / $vTotal) * 100, 1);
                }
                if (isset($parts[5]) && is_numeric($parts[5])) $gpuData['power_w'] = round((float)$parts[5], 1);
                if (isset($parts[6]) && is_numeric($parts[6])) $gpuData['clock_mhz'] = (int)$parts[6];
                if (isset($parts[7]) && is_numeric($parts[7])) $gpuData['max_clock_mhz'] = (int)$parts[7];
                $gpuData['driver'] = 'nvidia';
                $gpuData['active_apps'] = get_gpu_active_apps();
                return $gpuData;
            }
        }
    }

    // 3. Check Intel iGPU (QuickSync / i915 / Xe) via sysfs, intel_gpu_top and lspci
    $drmCards = glob('/sys/class/drm/card*');
    if ($drmCards) {
        foreach ($drmCards as $card) {
            if (preg_match('/renderD\d+$/', $card)) continue;
            $vendorFile = "{$card}/device/vendor";
            if (file_exists($vendorFile)) {
                $vendorHex = trim(@file_get_contents($vendorFile));
                if (stripos($vendorHex, '0x8086') !== false) {
                    $intelName = '';
                    $lspci = @shell_exec("lspci -nn -d 8086: 2>/dev/null | grep -iE 'vga|display|3d'");
                    if ($lspci) {
                        if (preg_match('/\[([^\]]*(?:Graphics|Iris|HD|UHD|Arc)[^\]]*)\]/i', $lspci, $subM)) {
                            $intelName = 'Intel® ' . trim($subM[1]);
                        } elseif (preg_match('/:\s*Intel Corporation\s+(.+?)(?:\s*\(rev|\s*\[[0-9a-f]{4}:|$)/i', $lspci, $m)) {
                            $intelName = 'Intel® ' . trim($m[1]);
                        } else {
                            $cleanL = preg_replace('/^[0-9a-f:.]+\s+[^:]+:\s*/i', '', trim(explode("\n", $lspci)[0]));
                            $cleanL = preg_replace('/^Intel Corporation\s*/i', '', $cleanL);
                            $cleanL = preg_replace('/\s*\(rev\s+[0-9a-f]+\)/i', '', $cleanL);
                            $intelName = 'Intel® ' . trim($cleanL);
                        }
                    }
                    if (!$intelName) {
                        $intelName = ($gpustatCand && stripos($gpustatCand['name'], 'Intel') !== false) ? $gpustatCand['name'] : 'Intel® 核芯显卡 (iGPU)';
                    }

                    // Read dynamic frequency
                    $curFreq = 0;
                    $maxFreq = 0;
                    $freqFiles = [
                        "{$card}/gt_act_freq_mhz",
                        "{$card}/gt_cur_freq_mhz",
                        "{$card}/device/drm/{$card}/gt_act_freq_mhz",
                        "{$card}/device/drm/{$card}/gt_cur_freq_mhz",
                    ];
                    foreach ($freqFiles as $ff) {
                        if (file_exists($ff)) {
                            $v = (int)trim(@file_get_contents($ff));
                            if ($v > 0) { $curFreq = $v; break; }
                        }
                    }
                    $maxFreqFiles = [
                        "{$card}/gt_max_freq_mhz",
                        "{$card}/device/drm/{$card}/gt_max_freq_mhz",
                    ];
                    foreach ($maxFreqFiles as $ff) {
                        if (file_exists($ff)) { $maxFreq = (int)trim(@file_get_contents($ff)); break; }
                    }

                    // Temperature
                    $temp = null;
                    $hwmon = glob("{$card}/device/hwmon/hwmon*/temp1_input");
                    if ($hwmon && file_exists($hwmon[0])) {
                        $tRaw = (int)trim(@file_get_contents($hwmon[0]));
                        if ($tRaw > 0) $temp = round($tRaw / 1000);
                    }

                    // Live engine usage query via intel_gpu_top (-n 2 outputs 2 samples and exits cleanly)
                    $intelUsage = null;
                    $topOut = @shell_exec('timeout 2s intel_gpu_top -J -s 100 -n 2 2>/dev/null');
                    if (!empty($topOut)) {
                        $topData = @json_decode(trim($topOut), true);
                        if (!is_array($topData)) {
                            if (preg_match_all('/\{[^{}]*"engines"\s*:\s*\{[\s\S]*?\}\s*\}/s', $topOut, $allMatches)) {
                                $lastMatch = end($allMatches[0]);
                                $topData = @json_decode($lastMatch, true);
                            }
                        }
                        if (is_array($topData)) {
                            $sample = isset($topData[1]) ? $topData[1] : (isset($topData[0]) ? $topData[0] : $topData);
                            if (isset($sample['engines']) && is_array($sample['engines'])) {
                                $maxEngineBusy = 0;
                                foreach ($sample['engines'] as $engName => $eng) {
                                    if (isset($eng['busy']) && is_numeric($eng['busy'])) {
                                        $b = (float)$eng['busy'];
                                        if ($b > $maxEngineBusy) $maxEngineBusy = $b;
                                    }
                                }
                                $intelUsage = round(max(0, min(100, $maxEngineBusy)), 1);
                            }
                        }
                    }

                    // Native Linux kernel RC6 standby differential calculation
                    $rc6Usage = get_intel_rc6_usage();
                    if ($rc6Usage !== null) {
                        if ($intelUsage === null || $rc6Usage > $intelUsage) {
                            $intelUsage = $rc6Usage;
                        }
                    }

                    // If intel_gpu_top and RC6 didn't return usage, check if gpustat has live usage
                    if ($intelUsage === null && $gpustatCand !== null && isset($gpustatCand['usage'])) {
                        $intelUsage = $gpustatCand['usage'];
                    }
                    if ($intelUsage === null) {
                        $intelUsage = 0;
                    }

                    $gpuData['name'] = $intelName;
                    $gpuData['vendor'] = 'Intel';
                    $gpuData['usage'] = $intelUsage;
                    $gpuData['temp'] = ($temp !== null) ? $temp : ($gpustatCand ? $gpustatCand['temp'] : null);
                    $gpuData['clock_mhz'] = $curFreq > 0 ? $curFreq : ($gpustatCand ? $gpustatCand['clock_mhz'] : null);
                    $gpuData['max_clock_mhz'] = $maxFreq > 0 ? $maxFreq : ($gpustatCand ? $gpustatCand['max_clock_mhz'] : null);
                    $gpuData['power_w'] = ($gpustatCand ? $gpustatCand['power_w'] : null);
                    $gpuData['vram_used'] = ($gpustatCand ? $gpustatCand['vram_used'] : null);
                    $gpuData['vram_total'] = ($gpustatCand ? $gpustatCand['vram_total'] : null);
                    $gpuData['vram_pct'] = ($gpustatCand ? $gpustatCand['vram_pct'] : 0);
                    $gpuData['driver'] = 'i915';
                    $gpuData['active_apps'] = get_gpu_active_apps();
                    return $gpuData;
                }
            }
        }
    }

    // 4. Check AMD GPU via amdgpu sysfs
    if ($drmCards) {
        foreach ($drmCards as $card) {
            if (preg_match('/renderD\d+$/', $card)) continue;
            $vendorFile = "{$card}/device/vendor";
            if (file_exists($vendorFile)) {
                $vendorHex = trim(@file_get_contents($vendorFile));
                if (stripos($vendorHex, '0x1002') !== false) {
                    $amdName = '';
                    $lspci = @shell_exec("lspci -nn -d 1002: 2>/dev/null | grep -iE 'vga|display|3d'");
                    if ($lspci) {
                        if (preg_match('/:\s*(.+?)(?:\s*\(rev|\s*\[[0-9a-f]{4}:)/i', $lspci, $m)) {
                            $amdName = trim($m[1]);
                        }
                    }
                    if (!$amdName) $amdName = 'AMD Radeon™ 显卡';

                    $busyFile = "{$card}/device/gpu_busy_percent";
                    $usage = file_exists($busyFile) ? (float)trim(@file_get_contents($busyFile)) : ($gpustatCand ? $gpustatCand['usage'] : 0);

                    $temp = null;
                    $hwmon = glob("{$card}/device/hwmon/hwmon*/temp1_input");
                    if ($hwmon && file_exists($hwmon[0])) {
                        $tRaw = (int)trim(@file_get_contents($hwmon[0]));
                        if ($tRaw > 0) $temp = round($tRaw / 1000);
                    }

                    $vramUsed = null;
                    $vramTotal = null;
                    $vUsedFile = "{$card}/device/mem_info_vram_used";
                    $vTotalFile = "{$card}/device/mem_info_vram_total";
                    if (file_exists($vUsedFile) && file_exists($vTotalFile)) {
                        $vramUsed = round((float)trim(@file_get_contents($vUsedFile)) / (1024 * 1024));
                        $vramTotal = round((float)trim(@file_get_contents($vTotalFile)) / (1024 * 1024));
                    }

                    $gpuData['name'] = $amdName;
                    $gpuData['vendor'] = 'AMD';
                    $gpuData['usage'] = max(0, min(100, $usage));
                    $gpuData['temp'] = ($temp !== null) ? $temp : ($gpustatCand ? $gpustatCand['temp'] : null);
                    $gpuData['vram_used'] = ($vramUsed !== null) ? $vramUsed : ($gpustatCand ? $gpustatCand['vram_used'] : null);
                    $gpuData['vram_total'] = ($vramTotal !== null) ? $vramTotal : ($gpustatCand ? $gpustatCand['vram_total'] : null);
                    $gpuData['vram_pct'] = ($gpuData['vram_total'] > 0) ? round(($gpuData['vram_used'] / $gpuData['vram_total']) * 100, 1) : ($gpustatCand ? $gpustatCand['vram_pct'] : 0);
                    $gpuData['driver'] = 'amdgpu';
                    $gpuData['active_apps'] = get_gpu_active_apps();
                    return $gpuData;
                }
            }
        }
    }

    // 5. If hardware direct probes found nothing but gpustat was present, return gpustat candidate
    if ($gpustatCand !== null) {
        $gpustatCand['active_apps'] = get_gpu_active_apps();
        return $gpustatCand;
    }

    // 6. Generic display fallback via lspci (ensure full PATH)
    $genLspci = @shell_exec("export PATH=\$PATH:/sbin:/usr/sbin:/usr/local/sbin:/usr/local/bin; lspci -nn 2>/dev/null | grep -iE 'vga compatible controller|3d controller|display controller'");
    if (empty($genLspci)) {
        $genLspci = @shell_exec("lspci 2>/dev/null | grep -iE 'vga compatible controller|3d controller|display controller'");
    }
    if ($genLspci && trim($genLspci) !== '') {
        $firstLine = explode("\n", trim($genLspci))[0];
        if (preg_match('/:\s*(.+)$/', $firstLine, $m)) {
            $rawModel = trim($m[1]);
            $vendor = (stripos($rawModel, 'Intel') !== false) ? 'Intel' : ((stripos($rawModel, 'NVIDIA') !== false) ? 'NVIDIA' : ((stripos($rawModel, 'AMD') !== false || stripos($rawModel, 'ATI') !== false) ? 'AMD' : 'Display'));
            $cleanName = $rawModel;
            if (preg_match('/\[([^\]]*(?:Graphics|Iris|HD|UHD|Arc|GeForce|Radeon)[^\]]*)\]/i', $rawModel, $bm)) {
                $cleanName = $bm[1];
            } else {
                $cleanName = preg_replace('/\s*\(rev\s+[0-9a-f]+\)/i', '', $cleanName);
                $cleanName = preg_replace('/^(Intel Corporation|NVIDIA Corporation|Advanced Micro Devices, Inc\.\s*\[AMD\/ATI\])\s*/i', '', $cleanName);
            }
            $gpuData['name'] = ($vendor === 'Intel' && stripos($cleanName, 'Intel') === false ? 'Intel® ' : '') . $cleanName;
            $gpuData['vendor'] = $vendor;
            $gpuData['driver'] = strtolower($vendor);
            if ($vendor === 'Intel') {
                $rc6 = get_intel_rc6_usage();
                if ($rc6 !== null) $gpuData['usage'] = $rc6;
            }
            $gpuData['active_apps'] = get_gpu_active_apps();
            return $gpuData;
        }
    }

    // 7. Direct Linux kernel /sys/bus/pci device detection
    $pciVga = glob('/sys/bus/pci/devices/*/class');
    if ($pciVga) {
        foreach ($pciVga as $classFile) {
            $classHex = trim(@file_get_contents($classFile));
            if (strpos($classHex, '0x03') === 0) { // 0x0300, 0x0302, 0x0380
                $devDir = dirname($classFile);
                $vendorHex = trim(@file_get_contents("{$devDir}/vendor"));
                $deviceHex = trim(@file_get_contents("{$devDir}/device"));
                $vendorName = 'GPU';
                if (stripos($vendorHex, '0x8086') !== false) $vendorName = 'Intel';
                elseif (stripos($vendorHex, '0x10de') !== false) $vendorName = 'NVIDIA';
                elseif (stripos($vendorHex, '0x1002') !== false) $vendorName = 'AMD';

                $iModel = ($vendorName === 'Intel') ? detect_cpu_igpu_model() : null;
                $gpuData['name'] = $iModel ?: ($vendorName . ' 显卡 (' . $deviceHex . ')');
                $gpuData['vendor'] = $vendorName;
                $gpuData['driver'] = ($vendorName === 'Intel') ? 'i915' : 'pci';
                if ($vendorName === 'Intel') {
                    $rc6 = get_intel_rc6_usage();
                    if ($rc6 !== null) $gpuData['usage'] = $rc6;
                }
                $gpuData['active_apps'] = get_gpu_active_apps();
                return $gpuData;
            }
        }
    }

    // 8. Intel / AMD CPU Integrated Graphics inference fallback (from /proc/cpuinfo)
    $cpuIgpu = detect_cpu_igpu_model();
    if ($cpuIgpu) {
        $gpuData['name'] = $cpuIgpu;
        $gpuData['vendor'] = (stripos($cpuIgpu, 'AMD') !== false) ? 'AMD' : 'Intel';
        $gpuData['driver'] = 'iGPU';
        $rc6 = get_intel_rc6_usage();
        if ($rc6 !== null) $gpuData['usage'] = $rc6;
        $gpuData['active_apps'] = get_gpu_active_apps();
        return $gpuData;
    }

    $gpuData['active_apps'] = get_gpu_active_apps();
    return $gpuData;
}

function handle_check_docker_updates() {
    @set_time_limit(180);
    @ini_set('max_execution_time', '180');

    $out = '';
    // Official Unraid scripts for checking docker updates
    if (file_exists('/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate.php')) {
        $out = (string)@shell_exec('php /usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate.php check 2>&1');
    } elseif (file_exists('/usr/local/emhttp/plugins/dynamix.docker.manager/include/DockerUpdate.php')) {
        $out = (string)@shell_exec('php /usr/local/emhttp/plugins/dynamix.docker.manager/include/DockerUpdate.php 2>&1');
    } elseif (file_exists('/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate')) {
        $out = (string)@shell_exec('/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate check 2>&1');
    }

    @file_put_contents('/tmp/unraid_last_docker_update_check.txt', time());
    usleep(500000); // 500ms for file writes to flush

    // Re-read docker updates map
    $dockerUpdatesMap = get_docker_updates_map();

    // Accurately count unique containers that have updates available
    $updatesCount = 0;
    $readyCount = 0;
    $newVersionCount = 0;
    $rawDocker = @shell_exec('docker ps -a --format "{{.Names}}\t{{.ID}}" 2>/dev/null');
    if ($rawDocker) {
        $lines = explode("\n", trim($rawDocker));
        foreach ($lines as $line) {
            $parts = explode("\t", trim($line));
            $cName = isset($parts[0]) ? ltrim(trim($parts[0]), '/') : '';
            $cId = isset($parts[1]) ? trim($parts[1]) : '';
            if (empty($cName)) continue;
            $info = null;
            $cleanName = ltrim($cName, '/');
            $candidates = [
                $cleanName,
                strtolower($cleanName),
                $cName,
                strtolower($cName),
            ];
            if (strpos($cleanName, 'my-') === 0) {
                $candidates[] = substr($cleanName, 3);
                $candidates[] = strtolower(substr($cleanName, 3));
            }
            if (!empty($cId)) {
                $candidates[] = substr($cId, 0, 12);
                $candidates[] = $cId;
            }
            foreach ($candidates as $cand) {
                if (isset($dockerUpdatesMap[$cand])) {
                    $info = $dockerUpdatesMap[$cand];
                    break;
                }
            }
            if (!empty($info['has_update'])) {
                $updatesCount++;
                if (!empty($info['status']) && $info['status'] === 'ready') {
                    $readyCount++;
                } else {
                    $newVersionCount++;
                }
            }
        }
    }

    if ($updatesCount > 0) {
        if ($readyCount > 0 && $newVersionCount > 0) {
            $msg = "检测完成，共发现 {$updatesCount} 个待更新容器（{$readyCount} 个更新就绪，{$newVersionCount} 个新版本待拉取）！";
        } elseif ($readyCount > 0) {
            $msg = "检测完成，共发现 {$readyCount} 个容器「更新就绪」，已在列表中为您标绿，可直接点击应用升级！";
        } else {
            $msg = "检测完成，共发现 {$newVersionCount} 个容器有新版本可用！";
        }
    } else {
        $msg = "检测完成，所有 Docker 容器均为最新版本。";
    }

    json_output([
        'status' => 'success',
        'message' => $msg,
        'update_count' => $updatesCount,
        'updates_count' => $updatesCount,
        'ready_count' => $readyCount,
        'new_version_count' => $newVersionCount,
        'output' => trim($out)
    ]);
}

/**
 * Parse string representations of byte sizes (e.g., "245.8MiB", "1.25 GB", "500kB")
 */
function parse_bytes_string($str) {
    if (empty($str)) return 0;
    $str = trim((string)$str);
    if (!preg_match('/^([0-9.]+)\s*([a-zA-Z]*)$/', $str, $m)) return 0;
    $val = (float)$m[1];
    $unit = strtoupper(trim($m[2]));
    switch ($unit) {
        case 'TB':
        case 'TIB':
            return round($val * 1024 * 1024 * 1024 * 1024);
        case 'GB':
        case 'GIB':
            return round($val * 1024 * 1024 * 1024);
        case 'MB':
        case 'MIB':
            return round($val * 1024 * 1024);
        case 'KB':
        case 'KIB':
            return round($val * 1024);
        case 'B':
        default:
            return round($val);
    }
}

/**
 * Intel iGPU RC6 residency active percentage calculation
 */
function get_intel_rc6_usage() {
    $rc6Files = [
        '/sys/class/drm/card0/power/rc6_residency_ms',
        '/sys/class/drm/card0/gt/gt0/rc6_residency_ms',
        '/sys/class/drm/card1/power/rc6_residency_ms',
        '/sys/class/drm/card1/gt/gt0/rc6_residency_ms',
    ];
    $rc6File = null;
    foreach ($rc6Files as $f) {
        if (file_exists($f)) {
            $rc6File = $f;
            break;
        }
    }
    if (!$rc6File) return null;

    $curRc6 = (float)trim(@file_get_contents($rc6File));
    $now = microtime(true);
    $stateFile = '/tmp/unraid_rc6_state.json';
    $usage = null;

    if (file_exists($stateFile)) {
        $lastState = @json_decode(@file_get_contents($stateFile), true);
        if (is_array($lastState) && isset($lastState['rc6_ms']) && isset($lastState['time'])) {
            $dt_ms = ($now - (float)$lastState['time']) * 1000.0;
            $drc6_ms = $curRc6 - (float)$lastState['rc6_ms'];
            if ($dt_ms >= 100.0 && $dt_ms < 60000.0 && $drc6_ms >= 0) {
                $sleepRatio = min(1.0, max(0.0, $drc6_ms / $dt_ms));
                $usage = round((1.0 - $sleepRatio) * 100.0, 1);
            }
        }
    }

    @file_put_contents($stateFile, json_encode(['rc6_ms' => $curRc6, 'time' => $now]), LOCK_EX);
    return $usage;
}

/**
 * Find processes and Docker containers currently accessing the GPU
 */
function get_gpu_active_apps() {
    $apps = [];
    $pids = [];

    // 1. Linux DRM /dev/dri clients (Intel QuickSync / AMD VA-API)
    $fuserOut = @shell_exec('fuser /dev/dri/renderD* /dev/dri/card* 2>/dev/null');
    if (!empty($fuserOut)) {
        $rawPids = preg_split('/\s+/', trim($fuserOut));
        foreach ($rawPids as $p) {
            $p = trim($p);
            if (is_numeric($p) && (int)$p > 0) {
                $pids[(int)$p] = ['source' => 'dri', 'name' => '', 'vram' => ''];
            }
        }
    }

    // 2. NVIDIA compute applications
    $nvidiaApps = @shell_exec('nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits 2>/dev/null');
    if (!empty($nvidiaApps)) {
        $lines = explode("\n", trim($nvidiaApps));
        foreach ($lines as $line) {
            $parts = array_map('trim', explode(',', $line));
            if (count($parts) >= 2 && is_numeric($parts[0])) {
                $pid = (int)$parts[0];
                $pids[$pid] = [
                    'source' => 'nvidia',
                    'name' => $parts[1],
                    'vram' => isset($parts[2]) ? $parts[2] . ' MB' : ''
                ];
            }
        }
    }

    if (empty($pids)) return [];

    // Resolve Docker container names
    $containerMap = [];
    $dockerPs = @shell_exec('docker ps --no-trunc --format "{{.ID}}\t{{.Names}}\t{{.Image}}" 2>/dev/null');
    if (!empty($dockerPs)) {
        $lines = explode("\n", trim($dockerPs));
        foreach ($lines as $line) {
            $cols = explode("\t", trim($line));
            if (count($cols) >= 2) {
                $longId = trim($cols[0]);
                $shortId = substr($longId, 0, 12);
                $cName = trim($cols[1]);
                $cImg = isset($cols[2]) ? trim($cols[2]) : '';
                $containerMap[$longId] = ['name' => $cName, 'image' => $cImg];
                $containerMap[$shortId] = ['name' => $cName, 'image' => $cImg];
            }
        }
    }

    foreach ($pids as $pid => $meta) {
        $procName = isset($meta['name']) ? $meta['name'] : '';
        if (empty($procName) && file_exists("/proc/{$pid}/comm")) {
            $procName = trim(@file_get_contents("/proc/{$pid}/comm"));
        }
        $cmdline = '';
        if (file_exists("/proc/{$pid}/cmdline")) {
            $cmdline = trim(str_replace("\0", " ", @file_get_contents("/proc/{$pid}/cmdline")));
        }

        $dockerId = null;
        $cgroupFile = "/proc/{$pid}/cgroup";
        if (file_exists($cgroupFile)) {
            $cgroup = @file_get_contents($cgroupFile);
            if (preg_match('/docker[/-]([a-f0-9]{12,64})/i', $cgroup, $cm)) {
                $dockerId = $cm[1];
            }
        }

        $appInfo = [
            'pid' => $pid,
            'name' => $procName ?: 'gpu_process',
            'command' => substr($cmdline, 0, 100),
            'vram' => isset($meta['vram']) ? $meta['vram'] : '',
            'source' => $meta['source'],
            'type' => 'process',
            'container_name' => null,
            'container_image' => null
        ];

        if ($dockerId) {
            $matched = null;
            if (isset($containerMap[$dockerId])) {
                $matched = $containerMap[$dockerId];
            } else {
                $prefix = substr($dockerId, 0, 12);
                if (isset($containerMap[$prefix])) {
                    $matched = $containerMap[$prefix];
                }
            }
            if ($matched) {
                $appInfo['type'] = 'docker';
                $appInfo['container_name'] = $matched['name'];
                $appInfo['container_image'] = $matched['image'];
            } else {
                $appInfo['type'] = 'docker';
                $appInfo['container_name'] = substr($dockerId, 0, 12);
            }
        } elseif (stripos($procName, 'qemu') !== false || stripos($cmdline, 'qemu') !== false) {
            $appInfo['type'] = 'vm';
        }

        $apps[] = $appInfo;
    }

    return $apps;
}

/**
 * Maintain rolling 5-minute telemetry history buffer in /tmp/
 */
function update_metrics_history($cpuUsage, $memUsage, $gpuUsage, $rxBps, $txBps) {
    $histFile = '/tmp/unraid_metrics_history.json';
    $history = [];
    if (file_exists($histFile)) {
        $data = @json_decode(@file_get_contents($histFile), true);
        if (is_array($data)) $history = $data;
    }
    $now = time();
    $history[] = [
        't' => $now,
        'cpu' => round((float)$cpuUsage, 1),
        'mem' => round((float)$memUsage, 1),
        'gpu' => round((float)$gpuUsage, 1),
        'rx' => round((float)$rxBps, 1),
        'tx' => round((float)$txBps, 1),
    ];
    if (count($history) > 150) {
        $history = array_slice($history, -150);
    }
    @file_put_contents($histFile, json_encode($history), LOCK_EX);
    return $history;
}

/**
 * Handle action=metrics_detail for 4 drill-down pages
 */
function handle_metrics_detail() {
    // 1. CPU
    $cpuUsage = 0;
    $cpuTemp = null;
    $cores = [];
    $cpuModel = 'x86_64 Processor';

    $cpuinfo = @file_get_contents('/proc/cpuinfo');
    if ($cpuinfo) {
        if (preg_match('/model name\s*:\s*(.+)$/m', $cpuinfo, $cm)) {
            $cpuModel = trim($cm[1]);
        }
    }

    $zones = @glob('/sys/class/thermal/thermal_zone*/temp');
    if ($zones) {
        foreach ($zones as $z) {
            $t = (int)trim(@file_get_contents($z));
            if ($t > 1000) $t = round($t / 1000);
            if ($t >= 20 && $t <= 110) {
                $cpuTemp = $t;
                break;
            }
        }
    }

    $statLines = @file('/proc/stat');
    $coreStatFile = '/tmp/unraid_cpucore_last.json';
    $now = microtime(true);
    $currentCores = [];
    if ($statLines) {
        foreach ($statLines as $line) {
            if (preg_match('/^cpu([0-9]+)\s+(.*)/', trim($line), $m)) {
                $coreId = (int)$m[1];
                $parts = preg_split('/\s+/', trim($m[2]));
                $total = array_sum($parts);
                $idle = isset($parts[3]) ? (float)$parts[3] : 0;
                $currentCores[$coreId] = ['total' => $total, 'idle' => $idle];
            }
        }
    }

    $lastCores = null;
    if (file_exists($coreStatFile)) {
        $lastData = @json_decode(@file_get_contents($coreStatFile), true);
        if (is_array($lastData) && isset($lastData['time']) && ($now - $lastData['time'] < 30)) {
            $lastCores = $lastData['cores'];
        }
    }

    if (!$lastCores && !empty($currentCores)) {
        usleep(50000); // 50ms measurement on initial poll
        $statLines2 = @file('/proc/stat');
        $lastCores = $currentCores;
        $currentCores = [];
        if ($statLines2) {
            foreach ($statLines2 as $line) {
                if (preg_match('/^cpu([0-9]+)\s+(.*)/', trim($line), $m)) {
                    $coreId = (int)$m[1];
                    $parts = preg_split('/\s+/', trim($m[2]));
                    $total = array_sum($parts);
                    $idle = isset($parts[3]) ? (float)$parts[3] : 0;
                    $currentCores[$coreId] = ['total' => $total, 'idle' => $idle];
                }
            }
        }
    }

    if (!empty($currentCores)) {
        @file_put_contents($coreStatFile, json_encode(['time' => $now, 'cores' => $currentCores]), LOCK_EX);
        foreach ($currentCores as $cid => $cur) {
            $u = 0;
            if ($lastCores && isset($lastCores[$cid])) {
                $dTotal = $cur['total'] - $lastCores[$cid]['total'];
                $dIdle = $cur['idle'] - $lastCores[$cid]['idle'];
                if ($dTotal > 0) {
                    $u = round(100.0 * ($dTotal - $dIdle) / $dTotal, 1);
                }
            }
            $cores[] = [
                'id' => $cid,
                'name' => "Core {$cid}",
                'usage' => max(0, min(100, $u))
            ];
        }
    }

    if (!empty($cores)) {
        $sumUsage = 0;
        foreach ($cores as $c) { $sumUsage += $c['usage']; }
        $cpuUsage = round($sumUsage / count($cores), 1);
    }

    $cpuProcs = [];
    $psCpu = @shell_exec("ps -eo pid,user,%cpu,%mem,comm,args --sort=-%cpu 2>/dev/null | head -n 30");
    if ($psCpu) {
        $lines = explode("\n", trim($psCpu));
        array_shift($lines);
        foreach ($lines as $line) {
            $parts = preg_split('/\s+/', trim($line), 6);
            if (count($parts) >= 5) {
                $comm = $parts[4];
                if ($comm === 'ps' || $comm === 'head') continue;
                $cpuProcs[] = [
                    'pid' => (int)$parts[0],
                    'user' => $parts[1],
                    'cpu_pct' => (float)$parts[2],
                    'mem_pct' => (float)$parts[3],
                    'name' => $comm,
                    'command' => isset($parts[5]) ? substr($parts[5], 0, 100) : $comm
                ];
            }
        }
    }

    // 2. Memory
    $meminfo = @file_get_contents('/proc/meminfo');
    $memData = [
        'total' => 0,
        'used' => 0,
        'free' => 0,
        'available' => 0,
        'buffers' => 0,
        'cached' => 0,
        'swap_total' => 0,
        'swap_used' => 0,
        'swap_free' => 0,
        'usage_pct' => 0
    ];
    if ($meminfo) {
        preg_match('/MemTotal:\s+(\d+)\s+kB/', $meminfo, $totalM);
        preg_match('/MemAvailable:\s+(\d+)\s+kB/', $meminfo, $availM);
        preg_match('/MemFree:\s+(\d+)\s+kB/', $meminfo, $freeM);
        preg_match('/Buffers:\s+(\d+)\s+kB/', $meminfo, $bufM);
        preg_match('/^Cached:\s+(\d+)\s+kB/m', $meminfo, $cacheM);
        preg_match('/SwapTotal:\s+(\d+)\s+kB/', $meminfo, $swapTotM);
        preg_match('/SwapFree:\s+(\d+)\s+kB/', $meminfo, $swapFreeM);

        $totKb = isset($totalM[1]) ? (float)$totalM[1] : 0;
        $availKb = isset($availM[1]) ? (float)$availM[1] : 0;
        $freeKb = isset($freeM[1]) ? (float)$freeM[1] : 0;
        $bufKb = isset($bufM[1]) ? (float)$bufM[1] : 0;
        $cacheKb = isset($cacheM[1]) ? (float)$cacheM[1] : 0;
        $swapTotKb = isset($swapTotM[1]) ? (float)$swapTotM[1] : 0;
        $swapFreeKb = isset($swapFreeM[1]) ? (float)$swapFreeM[1] : 0;

        if ($totKb > 0) {
            if ($availKb === 0.0) $availKb = $freeKb + $bufKb + $cacheKb;
            $memData['total'] = $totKb * 1024;
            $memData['available'] = $availKb * 1024;
            $memData['free'] = $freeKb * 1024;
            $memData['buffers'] = $bufKb * 1024;
            $memData['cached'] = $cacheKb * 1024;
            $memData['used'] = max(0, $memData['total'] - $memData['available']);
            $memData['usage_pct'] = round(($memData['used'] / $memData['total']) * 100, 1);
            $memData['swap_total'] = $swapTotKb * 1024;
            $memData['swap_free'] = $swapFreeKb * 1024;
            $memData['swap_used'] = max(0, ($swapTotKb - $swapFreeKb) * 1024);
        }
    }

    $memProcs = [];
    $psMem = @shell_exec("ps -eo pid,user,%cpu,%mem,comm,args --sort=-%mem 2>/dev/null | head -n 30");
    if ($psMem) {
        $lines = explode("\n", trim($psMem));
        array_shift($lines);
        foreach ($lines as $line) {
            $parts = preg_split('/\s+/', trim($line), 6);
            if (count($parts) >= 5) {
                $comm = $parts[4];
                if ($comm === 'ps' || $comm === 'head') continue;
                $memProcs[] = [
                    'pid' => (int)$parts[0],
                    'user' => $parts[1],
                    'cpu_pct' => (float)$parts[2],
                    'mem_pct' => (float)$parts[3],
                    'name' => $comm,
                    'command' => isset($parts[5]) ? substr($parts[5], 0, 100) : $comm
                ];
            }
        }
    }

    // 3. GPU Telemetry
    $gpuData = get_gpu_telemetry();

    // 4. Docker Stats Breakdown
    $dockerStats = [];
    $statsCacheFile = '/tmp/unraid_docker_stats.json';
    $cached = false;
    if (file_exists($statsCacheFile) && (time() - filemtime($statsCacheFile) < 3)) {
        $cJson = @json_decode(@file_get_contents($statsCacheFile), true);
        if (is_array($cJson)) {
            $dockerStats = $cJson;
            $cached = true;
        }
    }
    if (!$cached) {
        $statsOut = @shell_exec('timeout 3s docker stats --no-stream --format "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.ID}}" 2>/dev/null');
        if (!empty($statsOut)) {
            $lines = explode("\n", trim($statsOut));
            foreach ($lines as $line) {
                $cols = explode("\t", trim($line));
                if (count($cols) >= 5) {
                    $name = trim($cols[0]);
                    $cpuRaw = str_replace('%', '', trim($cols[1]));
                    $memRaw = trim($cols[2]);
                    $memPctRaw = str_replace('%', '', trim($cols[3]));
                    $netIoRaw = trim($cols[4]);
                    $blockIo = isset($cols[5]) ? trim($cols[5]) : '';
                    $cid = isset($cols[6]) ? trim($cols[6]) : '';

                    $memParts = explode('/', $memRaw);
                    $memUsedBytes = parse_bytes_string(trim($memParts[0]));
                    $memTotalBytes = isset($memParts[1]) ? parse_bytes_string(trim($memParts[1])) : 0;

                    $netParts = explode('/', $netIoRaw);
                    $netRxBytes = isset($netParts[0]) ? parse_bytes_string(trim($netParts[0])) : 0;
                    $netTxBytes = isset($netParts[1]) ? parse_bytes_string(trim($netParts[1])) : 0;

                    $dockerStats[] = [
                        'name' => $name,
                        'cpu_pct' => (float)$cpuRaw,
                        'mem_usage_str' => $memRaw,
                        'mem_used_bytes' => $memUsedBytes,
                        'mem_total_bytes' => $memTotalBytes,
                        'mem_pct' => (float)$memPctRaw,
                        'net_io_str' => $netIoRaw,
                        'net_rx_bytes' => $netRxBytes,
                        'net_tx_bytes' => $netTxBytes,
                        'block_io' => $blockIo,
                        'id' => $cid
                    ];
                }
            }
            @file_put_contents($statsCacheFile, json_encode($dockerStats), LOCK_EX);
        }
    }

    // 5. VMs List
    $vmsList = [];
    $virshOut = @shell_exec('virsh list --all 2>/dev/null');
    if ($virshOut) {
        $lines = explode("\n", trim($virshOut));
        if (count($lines) >= 3) {
            array_shift($lines);
            array_shift($lines);
            foreach ($lines as $line) {
                $line = trim($line);
                if (!$line) continue;
                $parts = preg_split('/\s+/', $line, 3);
                if (count($parts) >= 3) {
                    $vmsList[] = [
                        'id' => $parts[0] !== '-' ? (int)$parts[0] : null,
                        'name' => $parts[1],
                        'state' => $parts[2]
                    ];
                }
            }
        }
    }

    // 6. Network Interfaces
    $interfaces = [];
    $totalRx = 0;
    $totalTx = 0;
    $netDevLines = @file('/proc/net/dev');
    $nowFloat = microtime(true);
    $lastIfaceFile = '/tmp/unraid_ifaces_last.json';
    $lastIfaces = [];
    if (file_exists($lastIfaceFile)) {
        $lastIfaces = @json_decode(@file_get_contents($lastIfaceFile), true) ?: [];
    }
    $newIfaceData = ['time' => $nowFloat, 'ifaces' => []];

    if ($netDevLines) {
        foreach ($netDevLines as $nLine) {
            if (strpos($nLine, ':') === false) continue;
            $parts = explode(':', $nLine);
            $ifname = trim($parts[0]);
            if ($ifname === 'lo') continue;

            $vals = preg_split('/\s+/', trim($parts[1]));
            $rx = (float)$vals[0];
            $tx = (float)$vals[8];
            $newIfaceData['ifaces'][$ifname] = ['rx' => $rx, 'tx' => $tx];

            $rxBps = 0;
            $txBps = 0;
            if (isset($lastIfaces['ifaces'][$ifname]) && isset($lastIfaces['time'])) {
                $dt = $nowFloat - (float)$lastIfaces['time'];
                if ($dt > 0.2 && $dt < 60.0) {
                    $dRx = $rx - (float)$lastIfaces['ifaces'][$ifname]['rx'];
                    $dTx = $tx - (float)$lastIfaces['ifaces'][$ifname]['tx'];
                    if ($dRx >= 0) $rxBps = round($dRx / $dt);
                    if ($dTx >= 0) $txBps = round($dTx / $dt);
                }
            }

            $isPhysical = (strpos($ifname, 'eth') === 0 || strpos($ifname, 'en') === 0);
            $operState = @trim(@file_get_contents("/sys/class/net/{$ifname}/operstate")) ?: 'unknown';
            $macAddr = @trim(@file_get_contents("/sys/class/net/{$ifname}/address")) ?: '';

            $interfaces[] = [
                'name' => $ifname,
                'rx_bytes' => $rx,
                'tx_bytes' => $tx,
                'rx_bps' => $rxBps,
                'tx_bps' => $txBps,
                'state' => $operState,
                'mac' => $macAddr,
                'is_physical' => $isPhysical
            ];

            if ($isPhysical || $ifname === 'br0' || $ifname === 'bond0') {
                $totalRx += $rx;
                $totalTx += $tx;
            }
        }
    }
    @file_put_contents($lastIfaceFile, json_encode($newIfaceData), LOCK_EX);

    // 7. History
    $historyFile = '/tmp/unraid_metrics_history.json';
    $history = [];
    if (file_exists($historyFile)) {
        $history = @json_decode(@file_get_contents($historyFile), true) ?: [];
    }

    json_output([
        'status' => 'success',
        'api_version' => UNRAID_API_VERSION,
        'cpu' => [
            'usage' => $cpuUsage,
            'temp' => $cpuTemp,
            'model' => $cpuModel,
            'cores' => $cores,
            'top_processes' => $cpuProcs
        ],
        'memory' => array_merge($memData, [
            'top_processes' => $memProcs
        ]),
        'gpu' => $gpuData,
        'network' => [
            'total_rx_bytes' => $totalRx,
            'total_tx_bytes' => $totalTx,
            'interfaces' => $interfaces
        ],
        'dockers' => $dockerStats,
        'vms' => $vmsList,
        'history' => $history
    ]);
}

/**
 * Detect CPU Integrated Graphics model by inspecting /proc/cpuinfo or lshw/cpuid
 */
function detect_cpu_igpu_model() {
    $cpuinfo = @file_get_contents('/proc/cpuinfo');
    if (empty($cpuinfo)) return null;

    $modelName = '';
    if (preg_match('/model name\s*:\s*(.+)$/m', $cpuinfo, $m)) {
        $modelName = trim($m[1]);
    }
    if (empty($modelName)) return null;

    // Check Intel CPU generation and map to known iGPU
    if (stripos($modelName, 'Intel') !== false) {
        // N100, N95, N97, N200, N300, N305, i3-N305
        if (preg_match('/(N100|N95|N97|N200|N300|N305|i3-N\d+)/i', $modelName, $cm)) {
            return "Intel® UHD Graphics (Alder Lake-N {$cm[1]})";
        }
        // J4125, J4105, J4005, N4100, N4000 (Gemini Lake)
        if (preg_match('/(J4125|J4105|J4005|N4100|N4000|J5005|J5040|N5000|N5030)/i', $modelName, $cm)) {
            return "Intel® UHD Graphics 600/605 (Gemini Lake {$cm[1]})";
        }
        // N5105, N5095, N6005, J6412 (Jasper Lake / Elkhart Lake)
        if (preg_match('/(N5105|N5095|N6005|J6412|J6413)/i', $modelName, $cm)) {
            return "Intel® UHD Graphics (Jasper Lake {$cm[1]})";
        }
        // 12th/13th/14th Gen Core: i3/i5/i7/i9 - 12xxx, 13xxx, 14xxx
        if (preg_match('/i[3579]-1[234]\d{3}/i', $modelName, $cm)) {
            if (preg_match('/i[35]-1[234]100|i3-1[234]400/i', $modelName)) {
                return "Intel® UHD Graphics 730 ({$cm[0]})";
            }
            return "Intel® UHD Graphics 770 ({$cm[0]})";
        }
        // 11th Gen Core: i3/i5/i7/i9 - 11xxx
        if (preg_match('/i[3579]-11\d{3}/i', $modelName, $cm)) {
            return "Intel® UHD Graphics 750 ({$cm[0]})";
        }
        // 10th Gen Core: i3/i5/i7/i9 - 10xxx
        if (preg_match('/i[3579]-10\d{3}/i', $modelName, $cm)) {
            return "Intel® UHD Graphics 630 ({$cm[0]})";
        }
        // 9th Gen Core: i3/i5/i7/i9 - 9xxx
        if (preg_match('/i[3579]-9\d{3}/i', $modelName, $cm)) {
            return "Intel® UHD Graphics 630 ({$cm[0]})";
        }
        // 8th Gen Core: i3/i5/i7/i9 - 8xxx
        if (preg_match('/i[3579]-8\d{3}/i', $modelName, $cm)) {
            return "Intel® UHD Graphics 630 ({$cm[0]})";
        }
        // 7th Gen Core: i3/i5/i7/i9 - 7xxx
        if (preg_match('/i[3579]-7\d{3}/i', $modelName, $cm)) {
            return "Intel® HD Graphics 630 ({$cm[0]})";
        }
        // 6th Gen Core: i3/i5/i7/i9 - 6xxx
        if (preg_match('/i[3579]-6\d{3}/i', $modelName, $cm)) {
            return "Intel® HD Graphics 530 ({$cm[0]})";
        }
        // Generic Intel Core / Celeron / Pentium
        if (preg_match('/(Celeron|Pentium|Xeon|Core)/i', $modelName, $cm)) {
            return "Intel® 核芯显卡 (iGPU - {$cm[1]})";
        }
        return "Intel® 核芯显卡 (iGPU)";
    }

    // AMD APU
    if (stripos($modelName, 'AMD') !== false || stripos($modelName, 'Ryzen') !== false) {
        if (preg_match('/Ryzen.*?[0-9]{4}[GGE]/i', $modelName, $cm)) {
            return "AMD Radeon™ Graphics ({$cm[0]})";
        }
        if (stripos($modelName, 'Radeon') !== false) {
            return "AMD Radeon™ Graphics";
        }
    }

    return null;
}
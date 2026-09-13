<?php
@ini_set('max_execution_time', '0');
@ini_set('max_input_time', '0');
@ini_set('memory_limit', '512M');
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
    $candidates = [
        '/var/local/emhttp/unraid_api_debug.log',
        '/tmp/unraid_api_debug.log',
        '/tmp/unraid_upload_debug.log',
        dirname(__FILE__) . '/unraid_api_debug.log',
    ];
    foreach ($candidates as $p) {
        if (@file_exists($p) && @is_writable($p)) return $p;
        $d = dirname($p);
        if (@is_dir($d) && @is_writable($d)) return $p;
    }
    return '/tmp/unraid_api_debug.log';
}

function log_upload_debug($msg) {
    $path = get_debug_log_path();
    $time = date('Y-m-d H:i:s');
    @file_put_contents($path, "[{$time}] {$msg}\n", FILE_APPEND);
}

// Log every incoming request immediately before any exit or processing
$reqMethod = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'CLI';
$reqUri = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
$contentLen = isset($_SERVER['CONTENT_LENGTH']) ? $_SERVER['CONTENT_LENGTH'] : (isset($_SERVER['HTTP_CONTENT_LENGTH']) ? $_SERVER['HTTP_CONTENT_LENGTH'] : '0');
log_upload_debug("REQ: {$reqMethod} {$reqUri} len={$contentLen}");

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
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
        }
        log_upload_debug("FATAL ERROR: " . $err['message'] . " in " . basename($err['file']) . ":" . $err['line']);
        echo json_encode([
            'status' => 'error',
            'message' => 'PHP Fatal Error: ' . $err['message'] . ' in ' . basename($err['file']) . ':' . $err['line']
        ], JSON_UNESCAPED_UNICODE);
        @flush();
        exit;
    }

    // Guard against silent empty termination
    if (ob_get_length() === 0) {
        if (!headers_sent()) {
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode([
            'status' => 'error',
            'message' => 'PHP script terminated unexpectedly with empty output'
        ], JSON_UNESCAPED_UNICODE);
        @flush();
    }
});

ob_start();

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
        if (strpos($accept, 'text/html') !== false && empty($reqToken)) {
            $GLOBALS['__api_response_sent'] = true;
            header('Content-Type: text/html; charset=utf-8');
            http_response_code(200);
            $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'IP:端口';
            echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unraid API 正常运行中</title><style>body{font-family:system-ui,sans-serif;background:#111827;color:#f3f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0} .card{background:#1f2937;padding:32px;border-radius:16px;max-width:520px;box-shadow:0 10px 25px rgba(0,0,0,0.5)} h1{color:#10b981;font-size:22px;margin-top:0} code{background:#374151;padding:2px 8px;border-radius:4px;color:#f59e0b} a{color:#3b82f6;text-decoration:none} a:hover{text-decoration:underline}</style></head><body>';
            echo '<div class="card"><h1>✅ Unraid API 服务运行正常！</h1>';
            echo '<p>您正在访问 Unraid Mobile Manager 后端 API 接口。</p>';
            $activeToken = get_configured_token();
            $tokenSource = ($activeToken !== FALLBACK_TOKEN) ? ' <small style="color:#10b981">(读取自 unraid_api_token.txt)</small>' : ' <small style="color:#9ca3af">(默认内置)</small>';
            echo '<p>📱 <b>手机 App 连接配置：</b></p>';
            echo '<ul><li><b>服务器地址：</b> <code>http://' . htmlspecialchars($host) . '</code></li><li><b>API Token：</b> <code>' . htmlspecialchars($activeToken) . '</code>' . $tokenSource . '</li></ul>';
            echo '<p>⚙️ <b>API 版本：</b> <code>2026.09.13.4</code> <small style="color:#10b981">(Docker 原子重建引擎已就绪)</small><br>📁 <b>当前文件：</b> <code>' . htmlspecialchars(__FILE__) . '</code></p>';
            echo '<p>🔗 <b>API 测试链接：</b><br><a href="?token=' . urlencode($activeToken) . '&action=status">点击此处测试获取系统状态数据 (JSON) &rarr;</a></p>';
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

    case 'ca_apps':
        handle_ca_apps();
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

    case 'self_update_api':
        handle_self_update_api();
        break;

    default:
        json_output(['status' => 'error', 'message' => "Unknown action: {$action}"], 400);
        break;
}

// -------------------------------------------------------------
// Helper Output Function
// -------------------------------------------------------------
function json_output($data, $code = 200) {
    $GLOBALS['__api_response_sent'] = true;
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
    }

    // Recursively guarantee all string values are valid UTF-8
    array_walk_recursive($data, function(&$val) {
        if (is_string($val)) {
            if (!mb_check_encoding($val, 'UTF-8')) {
                $val = @mb_convert_encoding($val, 'UTF-8', 'UTF-8, GB18030, GBK, BIG5, ISO-8859-1');
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

    echo $json;
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
    $iniFile = '/var/local/emhttp/docker.ini';
    if (file_exists($iniFile)) {
        // Method 1: parse_ini_file
        $ini = @parse_ini_file($iniFile, true);
        if (is_array($ini)) {
            foreach ($ini as $cName => $sec) {
                $isUpdate = (
                    (isset($sec['updated']) && ($sec['updated'] === 'false' || $sec['updated'] === 0 || $sec['updated'] === '0' || strtolower((string)$sec['updated']) === 'no')) ||
                    (isset($sec['update']) && ($sec['update'] === 'true' || $sec['update'] === 'yes' || $sec['update'] === 1 || $sec['update'] === '1' || stripos((string)$sec['update'], 'ready') !== false)) ||
                    (isset($sec['install']) && stripos((string)$sec['install'], 'update') !== false) ||
                    (isset($sec['status']) && stripos((string)$sec['status'], 'update') !== false)
                );
                if ($isUpdate) {
                    $dockerUpdatesMap[$cName] = true;
                    $dockerUpdatesMap[strtolower($cName)] = true;
                    $dockerUpdatesMap[ltrim($cName, '/')] = true;
                    if (!empty($sec['repository'])) {
                        $dockerUpdatesMap[$sec['repository']] = true;
                        $dockerUpdatesMap[strtolower($sec['repository'])] = true;
                    }
                }
            }
        }

        // Method 2: Robust Line-by-line regex fallback
        $raw = @file_get_contents($iniFile);
        if ($raw) {
            $currSec = '';
            $currSecRepo = '';
            $currSecHasUpdate = false;

            $lines = explode("\n", $raw);
            foreach ($lines as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === ';') continue;

                if (preg_match('/^\[(.*)\]$/', $line, $sm)) {
                    if ($currSec !== '' && $currSecHasUpdate) {
                        $dockerUpdatesMap[$currSec] = true;
                        $dockerUpdatesMap[strtolower($currSec)] = true;
                        $dockerUpdatesMap[ltrim($currSec, '/')] = true;
                        if ($currSecRepo !== '') {
                            $dockerUpdatesMap[$currSecRepo] = true;
                            $dockerUpdatesMap[strtolower($currSecRepo)] = true;
                        }
                    }
                    $currSec = trim($sm[1]);
                    $currSecRepo = '';
                    $currSecHasUpdate = false;
                } elseif (strpos($line, '=') !== false) {
                    list($key, $val) = explode('=', $line, 2);
                    $key = strtolower(trim($key));
                    $val = trim($val, " \t\n\r\0\x0B\"'");
                    if ($key === 'repository') {
                        $currSecRepo = $val;
                    }
                    if ($key === 'updated' && in_array(strtolower($val), ['false', '0', 'no', 'update', 'available'])) {
                        $currSecHasUpdate = true;
                    }
                    if ($key === 'update' && in_array(strtolower($val), ['true', '1', 'yes', 'update', 'ready'])) {
                        $currSecHasUpdate = true;
                    }
                    if (($key === 'status' || $key === 'install') && stripos($val, 'update') !== false) {
                        $currSecHasUpdate = true;
                    }
                }
            }
            if ($currSec !== '' && $currSecHasUpdate) {
                $dockerUpdatesMap[$currSec] = true;
                $dockerUpdatesMap[strtolower($currSec)] = true;
                $dockerUpdatesMap[ltrim($currSec, '/')] = true;
                if ($currSecRepo !== '') {
                    $dockerUpdatesMap[$currSecRepo] = true;
                    $dockerUpdatesMap[strtolower($currSecRepo)] = true;
                }
            }
        }
    }

    // Method 3: Scan Unraid notification files in /tmp/notifications/
    $notifDirs = ['/tmp/notifications/unread'];
    $ignoreWords = ['docker', 'container', 'image', 'for', 'of', 'all', 'a', 'an', 'the', 'is', 'available', 'update', 'updates', 'version', 'new', 'notice', 'tower', 'server', 'unraid'];

    $registerCandidate = function($cand) use (&$dockerUpdatesMap, $ignoreWords) {
        $cand = trim($cand, " \t\n\r\0\x0B.:'\"[]()<>");
        if (empty($cand) || in_array(strtolower($cand), $ignoreWords) || strlen($cand) < 2) {
            return;
        }
        $dockerUpdatesMap[$cand] = true;
        $dockerUpdatesMap[strtolower($cand)] = true;
        $dockerUpdatesMap[ltrim($cand, '/')] = true;
        $dockerUpdatesMap[strtolower(ltrim($cand, '/'))] = true;
        $baseName = basename($cand);
        if (!empty($baseName) && !in_array(strtolower($baseName), $ignoreWords)) {
            $dockerUpdatesMap[$baseName] = true;
            $dockerUpdatesMap[strtolower($baseName)] = true;
        }
        if (strpos($cand, ':') !== false) {
            $noTag = explode(':', $cand)[0];
            if (!empty($noTag) && !in_array(strtolower($noTag), $ignoreWords)) {
                $dockerUpdatesMap[$noTag] = true;
                $dockerUpdatesMap[strtolower($noTag)] = true;
            }
        }
    };

    foreach ($notifDirs as $ndir) {
        if (!is_dir($ndir)) continue;
        $nfiles = @scandir($ndir);
        if (!$nfiles) continue;
        foreach ($nfiles as $nf) {
            if ($nf === '.' || $nf === '..') continue;
            $filePath = "{$ndir}/{$nf}";
            if (is_dir($filePath)) continue;
            $ncontent = @file_get_contents($filePath);
            if (!$ncontent) continue;

            $cleanContent = strip_tags($ncontent);

            // Pattern 1: Standard Unraid notification format: "A new version of <name> is available" / "An update for <name> is available"
            if (preg_match_all('/(?:A\s+new\s+version\s+of|An?\s+update\s+(?:is\s+)?available\s+for|New\s+version\s+(?:available\s+)?for)\s+([a-zA-Z0-9_\-\.\/]+)/i', $cleanContent, $m1)) {
                foreach ($m1[1] as $c) {
                    $registerCandidate($c);
                }
            }

            // Pattern 2: "Version update of <name>" / "Version update for <name>"
            if (preg_match_all('/(?:Version\s+update\s+(?:available\s+)?(?:of|for))\s+([a-zA-Z0-9_\-\.\/]+)/i', $cleanContent, $m2)) {
                foreach ($m2[1] as $c) {
                    $registerCandidate($c);
                }
            }

            // Pattern 3: "Docker container update available for <name>" / "container update available: <name>"
            if (preg_match_all('/(?:Docker\s+(?:container|image)\s+update\s+available\s+for|update\s+available\s+for(?:\s+container)?|container\s+update\s+available:?)\s+([a-zA-Z0-9_\-\.\/]+)/i', $cleanContent, $m3)) {
                foreach ($m3[1] as $c) {
                    $registerCandidate($c);
                }
            }

            // Pattern 4: "<name> update is available" / "<name> has an update available"
            if (preg_match_all('/([a-zA-Z0-9_\-\.\/]+)\s+(?:has\s+an?\s+update\s+available|update\s+is\s+available)/i', $cleanContent, $m4)) {
                foreach ($m4[1] as $c) {
                    $registerCandidate($c);
                }
            }

            // Pattern 5: Chinese Unraid notices
            if (preg_match_all('/(?:容器|镜像)\s*[\[【“"\']?([a-zA-Z0-9_\-\.\/]+)[\]】”"\']?\s*(?:有新版本|有可用更新|可更新|更新可用|存在更新)/u', $cleanContent, $m5)) {
                foreach ($m5[1] as $c) {
                    $registerCandidate($c);
                }
            }
            if (preg_match_all('/([a-zA-Z0-9_\-\.\/]+)\s*(?:有新版本|有可用更新|存在更新)/u', $cleanContent, $m5b)) {
                foreach ($m5b[1] as $c) {
                    $registerCandidate($c);
                }
            }

            // Pattern 6: Line-by-line inspection of subject/title/message
            $lines = explode("\n", $cleanContent);
            foreach ($lines as $line) {
                $line = trim($line);
                if (empty($line)) continue;
                if (preg_match('/^(?:subject|title|description|message)\s*=\s*(.*)$/i', $line, $lm)) {
                    $val = trim($lm[1]);
                    if (preg_match('/(?:Version\s+update\s+of|A\s+new\s+version\s+of|update\s+available\s+for|update\s+of)\s+([a-zA-Z0-9_\-\.\/]+)/i', $val, $vm)) {
                        $registerCandidate($vm[1]);
                    }
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
                $dockersList[] = [
                    'name' => $cleanName,
                    'status' => $cStatus,
                    'cpu' => $cpuStr,
                    'memory' => $memStr,
                    'mem' => $memStr,
                    'ports' => $cPortsRaw,
                    'port' => $primaryPort,
                    'webui' => $webuiUrl,
                    'update_available' => (
                    !empty($dockerUpdatesMap[$cleanName]) ||
                    !empty($dockerUpdatesMap[$cName]) ||
                    !empty($dockerUpdatesMap[strtolower($cleanName)]) ||
                    (!empty($cImage) && !empty($dockerUpdatesMap[$cImage])) ||
                    (!empty($cImage) && !empty($dockerUpdatesMap[strtolower($cImage)]))
                ),
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

    // 7. Network rx/tx bytes
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
        'api_version' => '2026.09.13.4',
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
            'mac' => get_server_mac()
        ],
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
    json_output(['status' => 'success', 'message' => "Docker action {$action} executed", 'output' => trim($out)]);
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
                        $inTargetSec = ($sName === $cleanTarget || ltrim($sName, '/') === $cleanTarget || strtolower($sName) === strtolower($cleanTarget));
                    } elseif ($inTargetSec && strpos($iLine, '=') !== false) {
                        $parts = explode('=', $iLine, 2);
                        $kTrim = strtolower(trim($parts[0]));
                        if ($kTrim === 'updated') {
                            $iLine = 'updated="true"';
                        } elseif ($kTrim === 'update') {
                            $iLine = 'update="false"';
                        } elseif ($kTrim === 'status') {
                            $iLine = 'status=""';
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

        $newContainerImgId = trim(@shell_exec("docker inspect --format '{{.Image}}' {$escaped} 2>/dev/null"));
        $newContainerImgCreated = trim(@shell_exec("docker inspect --format '{{.Created}}' " . escapeshellarg($newContainerImgId) . " 2>/dev/null"));
        $containerCreated = trim(@shell_exec("docker inspect --format '{{.Created}}' {$escaped} 2>/dev/null"));

        json_output([
            'status' => 'success',
            'message' => "容器 [{$cleanTarget}] 升级成功！已更新至最新版本" . ($wasRunning ? "并已重新运行。" : "（保持停止状态）。"),
            'details' => [
                'container' => $cleanTarget,
                'old_container_id' => substr($oldId, 0, 12),
                'new_container_id' => !empty($newId) ? substr($newId, 0, 12) : substr($oldId, 0, 12),
                'old_image_id' => substr($oldImgId, 0, 19),
                'new_image_id' => substr($newContainerImgId, 0, 19),
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
    $urls = [
        'https://fastly.jsdelivr.net/gh/wangzh6859/unraid2@main/api.php',
        'https://cdn.jsdelivr.net/gh/wangzh6859/unraid2@main/api.php',
        'https://ghproxy.net/https://raw.githubusercontent.com/wangzh6859/unraid2/main/api.php',
        'https://raw.githubusercontent.com/wangzh6859/unraid2/main/api.php'
    ];

    $newContent = null;
    $usedUrl = '';
    $lastErr = '';

    foreach ($urls as $u) {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $u);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 20);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
        $res = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($httpCode === 200 && $res && strlen($res) > 50000 && strpos($res, '<?php') !== false) {
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

    json_output([
        'status' => 'success',
        'message' => "api.php 在线更新成功！已更新至最新版本（大小: " . round($written / 1024, 1) . " KB）。",
        'file' => $currentFile,
        'source' => $usedUrl,
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

    $projects = [];
    $seenNames = [];

    // Pre-query all compose-labeled containers
    $composeContainers = [];
    $psOut = @shell_exec('docker ps -a --filter "label=com.docker.compose.project" --format "{{.Label \"com.docker.compose.project\"}}\t{{.Label \"com.docker.compose.service\"}}\t{{.Names}}\t{{.Status}}\t{{.State}}" 2>/dev/null');
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
    $target = isset($_GET['target']) ? trim($_GET['target']) : '';
    $cmd = isset($_GET['compose_cmd']) ? trim($_GET['compose_cmd']) : (isset($_GET['cmd']) ? trim($_GET['cmd']) : 'up');
    $path = isset($_GET['path']) ? trim($_GET['path']) : '';

    if (empty($target) && empty($path)) {
        json_output(['status' => 'error', 'message' => 'Missing target project name or path'], 400);
    }

    // Locate yaml file
    $yamlFile = '';
    if (!empty($path) && file_exists($path)) {
        $yamlFile = is_dir($path) ? "{$path}/docker-compose.yml" : $path;
    } else {
        $searchDirs = [
            '/boot/config/plugins/compose.manager/projects',
            '/boot/config/plugins/docker.compose/projects',
            '/mnt/user/appdata/compose',
            '/mnt/user/appdata/docker-compose'
        ];
        foreach ($searchDirs as $d) {
            $candidates = [
                "{$d}/{$target}/docker-compose.yml",
                "{$d}/{$target}/docker-compose.yaml",
                "{$d}/{$target}/compose.yml",
                "{$d}/{$target}/compose.yaml"
            ];
            foreach ($candidates as $c) {
                if (file_exists($c)) {
                    $yamlFile = $c;
                    break 2;
                }
            }
        }
    }

    if (!file_exists($yamlFile)) {
        json_output(['status' => 'error', 'message' => "Compose file not found for project [{$target}]"], 404);
    }

    $composeBin = get_compose_cmd();
    $escapedFile = escapeshellarg($yamlFile);
    $dir = dirname($yamlFile);
    $escapedDir = escapeshellarg($dir);

    $execCmd = '';
    switch ($cmd) {
        case 'up':
        case 'start':
            $execCmd = "cd {$escapedDir} && {$composeBin} -f {$escapedFile} up -d 2>&1";
            break;
        case 'down':
        case 'stop':
            $execCmd = "cd {$escapedDir} && {$composeBin} -f {$escapedFile} down 2>&1";
            break;
        case 'restart':
            $execCmd = "cd {$escapedDir} && {$composeBin} -f {$escapedFile} restart 2>&1";
            break;
        case 'pull':
            $execCmd = "cd {$escapedDir} && {$composeBin} -f {$escapedFile} pull 2>&1";
            break;
        default:
            json_output(['status' => 'error', 'message' => "Unsupported compose command: {$cmd}"], 400);
    }

    $out = @shell_exec($execCmd);
    json_output([
        'status' => 'success',
        'project' => $target,
        'action' => $cmd,
        'output' => trim($out)
    ]);
}

function handle_compose_file() {
    $target = isset($_GET['target']) ? trim($_GET['target']) : '';
    $path = isset($_GET['path']) ? trim($_GET['path']) : '';
    
    $yamlFile = '';
    if (!empty($path) && file_exists($path)) {
        $yamlFile = $path;
    } else {
        $searchDirs = [
            '/boot/config/plugins/compose.manager/projects',
            '/boot/config/plugins/docker.compose/projects',
            '/mnt/user/appdata/compose',
            '/mnt/user/appdata/docker-compose'
        ];
        foreach ($searchDirs as $d) {
            $candidates = ["{$d}/{$target}/docker-compose.yml", "{$d}/{$target}/compose.yml"];
            foreach ($candidates as $c) {
                if (file_exists($c)) { $yamlFile = $c; break 2; }
            }
        }
    }

    if (!file_exists($yamlFile)) {
        json_output(['status' => 'error', 'message' => "Compose file not found"], 404);
    }

    $content = @file_get_contents($yamlFile);
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

    $yamlFile = $path;
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
    $target = isset($_GET['target']) ? trim($_GET['target']) : '';
    $path = isset($_GET['path']) ? trim($_GET['path']) : '';
    $lines = isset($_GET['lines']) ? (int)$_GET['lines'] : 150;

    $yamlFile = $path;
    if (empty($yamlFile)) {
        $searchDirs = [
            '/boot/config/plugins/compose.manager/projects',
            '/boot/config/plugins/docker.compose/projects',
            '/mnt/user/appdata/compose'
        ];
        foreach ($searchDirs as $d) {
            if (file_exists("{$d}/{$target}/docker-compose.yml")) {
                $yamlFile = "{$d}/{$target}/docker-compose.yml";
                break;
            }
        }
    }

    if (!file_exists($yamlFile)) {
        json_output(['status' => 'error', 'message' => 'Compose file not found'], 404);
    }

    $composeBin = get_compose_cmd();
    $escapedFile = escapeshellarg($yamlFile);
    $out = @shell_exec("{$composeBin} -f {$escapedFile} logs --tail={$lines} --timestamps 2>&1");
    json_output([
        'status' => 'success',
        'project' => $target,
        'logs' => $out ? trim($out) : '暂无日志输出'
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
    json_output(['status' => 'success', 'message' => "VM action {$action} executed", 'output' => trim($out)]);
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
    $rawPath = isset($_GET['path']) ? $_GET['path'] : ALLOWED_ROOT;
    $targetDir = sanitize_path($rawPath);

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

    json_output([
        'status' => 'success',
        'current_path' => $targetDir,
        'parent_path' => $parentPath,
        'is_root' => $isRoot,
        'csrf_token' => get_system_csrf_token(),
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
    $rawPath = isset($_GET['path']) ? $_GET['path'] : '';
    $filePath = sanitize_path($rawPath);

    clearstatcache(true, $filePath);
    if (!file_exists($filePath) || is_dir($filePath)) {
        json_output(['status' => 'error', 'message' => 'File not found: ' . $filePath], 404);
    }

    $size = filesize($filePath);
    if ($size > 10 * 1024 * 1024) { // 10MB limit for text reader
        json_output(['status' => 'error', 'message' => 'File too large to open as text (max 10MB)'], 400);
    }

    $content = file_get_contents($filePath);
    // Convert to UTF-8 if encoded in GBK/GB2312/CP936/etc.
    if (!mb_check_encoding($content, 'UTF-8')) {
        $converted = @mb_convert_encoding($content, 'UTF-8', 'GB18030, GBK, BIG5, ISO-8859-1, ASCII');
        if ($converted !== false) {
            $content = $converted;
        }
    }

    json_output([
        'status' => 'success',
        'path' => $filePath,
        'size' => $size,
        'content' => $content
    ]);
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

    $rawPath = isset($_GET['path']) ? $_GET['path'] : (isset($_POST['path']) ? $_POST['path'] : ALLOWED_ROOT);
    $targetDir = sanitize_path($rawPath);
    
    // Prevent uploading directly to Unraid user shares root
    if ($targetDir === '/mnt' || $targetDir === '/mnt/user') {
        json_output([
            'status' => 'error',
            'message' => '无法直接上传到共享根目录 /mnt/user，请先点击进入具体的共享文件夹（例如 downloads、appdata 等）后再上传。'
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

    $filename = isset($_GET['filename']) ? trim($_GET['filename']) : (isset($_POST['filename']) ? trim($_POST['filename']) : '');
    if (stripos($filename, '%') !== false) {
        $filename = rawurldecode($filename);
    }

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

        $destName = !empty($filename) ? $filename : $file['name'];
        $cleanDestName = safe_basename($destName);
        if (empty($cleanDestName)) {
            $cleanDestName = 'upload_' . time();
        }
        $destPath = rtrim($targetDir, '/') . '/' . $cleanDestName;

        $uploadSuccess = false;
        if (@move_uploaded_file($file['tmp_name'], $destPath)) {
            $uploadSuccess = true;
        } elseif (@copy($file['tmp_name'], $destPath)) {
            $uploadSuccess = true;
            @unlink($file['tmp_name']);
        } else {
            // Stream copy fallback
            $in = @fopen($file['tmp_name'], 'rb');
            $out = @fopen($destPath, 'wb');
            if ($in && $out) {
                while (!feof($in)) {
                    $buf = fread($in, 65536);
                    if ($buf !== false && strlen($buf) > 0) {
                        fwrite($out, $buf);
                    }
                }
                fclose($in);
                fclose($out);
                @unlink($file['tmp_name']);
                $uploadSuccess = true;
            }
        }

        if (!$uploadSuccess) {
            $err = error_get_last();
            $msg = $err ? $err['message'] : '未知权限错误';
            log_upload_debug("file_upload write failed for {$destPath}: {$msg}");
            json_output(['status' => 'error', 'message' => "无法将文件写入目标路径: {$destPath} ({$msg})"], 500);
        }

        @chmod($destPath, 0666);
        if (function_exists('posix_getuid') && @posix_getuid() === 0) {
            @chown($destPath, 'nobody');
            @chgrp($destPath, 'users');
        }
        clearstatcache(true, $destPath);
        $finalSize = @filesize($destPath);
        log_upload_debug("file_upload ok: dest={$destPath}, size={$finalSize}");

        json_output([
            'status' => 'success',
            'message' => '文件已成功上传至 Unraid 存储',
            'path' => $destPath,
            'size' => $finalSize
        ]);
    } else {
        // Direct stream / chunk upload
        $destName = !empty($filename) ? $filename : 'upload_' . time();
        $cleanDestName = safe_basename($destName);
        $destPath = rtrim($targetDir, '/') . '/' . $cleanDestName;
        
        $in = @fopen('php://input', 'rb');
        if (!$in) {
            json_output(['status' => 'error', 'message' => 'Failed to open php://input stream'], 500);
        }
        $out = @fopen($destPath, 'wb');
        if (!$out) {
            @fclose($in);
            json_output(['status' => 'error', 'message' => 'Failed to open destination file for writing: ' . $destPath], 500);
        }

        if (function_exists('stream_set_chunk_size')) {
            @stream_set_chunk_size($in, 524288);
            @stream_set_chunk_size($out, 524288);
        }
        if (function_exists('stream_set_write_buffer')) {
            @stream_set_write_buffer($out, 0);
        }

        $bytesWritten = 0;
        if (function_exists('stream_copy_to_stream')) {
            $bytesWritten = @stream_copy_to_stream($in, $out);
        }
        if ($bytesWritten === 0 || $bytesWritten === false) {
            $bytesWritten = 0;
            while (!feof($in)) {
                @set_time_limit(0);
                $buff = fread($in, 524288);
                if ($buff === false || $buff === '') {
                    break;
                }
                $w = fwrite($out, $buff);
                if ($w === false) {
                    break;
                }
                $bytesWritten += $w;
            }
        }
        @fflush($out);
        @fclose($out);
        @fclose($in);

        clearstatcache(true, $destPath);
        if ($bytesWritten === 0 || !file_exists($destPath) || filesize($destPath) === 0) {
            @unlink($destPath);
            json_output(['status' => 'error', 'message' => '未接收到上传数据（0 字节）。若文件较大，可能超出了 Unraid Nginx/PHP 的 post_max_size 限制。'], 400);
        }

        @chmod($destPath, 0666);
        if (function_exists('posix_getuid') && @posix_getuid() === 0) {
            @chown($destPath, 'nobody');
            @chgrp($destPath, 'users');
        }
        json_output([
            'status' => 'success',
            'message' => 'Raw stream upload complete',
            'path' => $destPath,
            'size' => filesize($destPath)
        ]);
    }
}

/**
 * Robust chunked upload handler:
 * Receives chunks via Multipart ($_FILES['chunk']) OR Base64 JSON payload,
 * writes into file at specified offset, bypassing PHP post_max_size limits.
 */
function handle_file_chunk() {
    @set_time_limit(0);
    @ini_set('max_execution_time', '0');
    @ini_set('max_input_time', '0');
    @ini_set('memory_limit', '512M');
    @ignore_user_abort(true);
    try {
        log_upload_debug("handle_file_chunk entered");
        $payload = [];
        $binaryData = '';

        if (!empty($_FILES['chunk']) && $_FILES['chunk']['error'] === UPLOAD_ERR_OK) {
            $payload = $_POST;
            $binaryData = @file_get_contents($_FILES['chunk']['tmp_name']);
            @unlink($_FILES['chunk']['tmp_name']);
            log_upload_debug("chunk_mode: multipart, bytes=" . strlen($binaryData));
        } elseif (!empty($_POST['data'])) {
            $payload = $_POST;
            $binaryData = base64_decode($_POST['data']);
            log_upload_debug("chunk_mode: post_form, binLen=" . strlen($binaryData));
        } elseif (!empty($_GET['data'])) {
            $payload = $_GET;
            $binaryData = base64_decode($_GET['data']);
            log_upload_debug("chunk_mode: get_query, binLen=" . strlen($binaryData));
        } else {
            $rawInput = file_get_contents('php://input');
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

        $rawPath = isset($payload['path']) ? $payload['path'] : (isset($_POST['path']) ? $_POST['path'] : (isset($_GET['path']) ? $_GET['path'] : ALLOWED_ROOT));
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

        $filename = isset($payload['filename']) ? trim($payload['filename']) : (isset($_POST['filename']) ? trim($_POST['filename']) : (isset($_GET['filename']) ? trim($_GET['filename']) : ''));
        if (stripos($filename, '%') !== false) {
            $filename = rawurldecode($filename);
        }
        $cleanName = safe_basename($filename);
        if (empty($cleanName)) {
            log_upload_debug("chunk_err: empty filename");
            json_output(['status' => 'error', 'message' => '文件名不能为空'], 400);
        }

        $destPath = rtrim($targetDir, '/') . '/' . $cleanName;
        $chunkIndex = isset($payload['chunk_index']) ? intval($payload['chunk_index']) : (isset($_POST['chunk_index']) ? intval($_POST['chunk_index']) : (isset($_GET['chunk_index']) ? intval($_GET['chunk_index']) : 0));
        $totalChunks = isset($payload['total_chunks']) ? intval($payload['total_chunks']) : (isset($_POST['total_chunks']) ? intval($_POST['total_chunks']) : (isset($_GET['total_chunks']) ? intval($_GET['total_chunks']) : 1));
        $offset = isset($payload['offset']) ? floatval($payload['offset']) : (isset($_POST['offset']) ? floatval($_POST['offset']) : (isset($_GET['offset']) ? floatval($_GET['offset']) : 0));
        $totalSize = isset($payload['total_size']) ? floatval($payload['total_size']) : (isset($_POST['total_size']) ? floatval($_POST['total_size']) : (isset($_GET['total_size']) ? floatval($_GET['total_size']) : 0));

        // First chunk creates/truncates the file, subsequent chunks append/seek
        $fp = false;
        if ($chunkIndex === 0 && $offset == 0) {
            $fp = @fopen($destPath, 'wb');
        } else {
            if (file_exists($destPath)) {
                $fp = @fopen($destPath, 'r+b');
            }
            if (!$fp) {
                $fp = @fopen($destPath, 'c+b');
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
        @fflush($fp);
        @fclose($fp);

        if (strlen($binaryData) > 0 && ($written === false || $written !== strlen($binaryData))) {
            log_upload_debug("chunk_err: write partial for {$destPath}, expected=" . strlen($binaryData) . " wrote={$written}");
            json_output(['status' => 'error', 'message' => "分片写入失败，目标磁盘可能空间不足。"], 500);
        }

        @chmod($destPath, 0666);
        if (function_exists('posix_getuid') && @posix_getuid() === 0) {
            @chown($destPath, 'nobody');
            @chgrp($destPath, 'users');
        }
        clearstatcache(true, $destPath);
        $currentSize = @filesize($destPath);
        $isComplete = ($chunkIndex + 1 >= $totalChunks);

        log_upload_debug("chunk_ok: file={$cleanName} chunk={$chunkIndex}/{$totalChunks} written={$written} curSize={$currentSize} complete=" . ($isComplete ? '1' : '0'));

        if ($isComplete) {
            json_output([
                'status' => 'success',
                'complete' => true,
                'message' => '文件已成功写入 Unraid 存储',
                'path' => $destPath,
                'size' => $currentSize,
                'total_size' => $totalSize
            ]);
        } else {
            json_output([
                'status' => 'success',
                'complete' => false,
                'chunk_index' => $chunkIndex,
                'bytes_written' => $written,
                'current_size' => $currentSize
            ]);
        }
    } catch (\Throwable $e) {
        log_upload_debug("chunk_exception: " . $e->getMessage() . " in " . basename($e->getFile()) . ":" . $e->getLine());
        json_output([
            'status' => 'error',
            'message' => '分片处理异常: ' . $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ')'
        ], 500);
    }
}

function handle_upload_debug() {
    $logContent = '';
    $usedPath = '';
    $candidates = [
        '/var/local/emhttp/unraid_api_debug.log',
        '/tmp/unraid_api_debug.log',
        '/tmp/unraid_upload_debug.log',
        dirname(__FILE__) . '/unraid_api_debug.log',
    ];
    foreach ($candidates as $p) {
        if (@file_exists($p)) {
            $raw = @file_get_contents($p);
            if (!empty($raw)) {
                $logContent = $raw;
                $usedPath = $p;
                break;
            }
        }
    }
    if (empty($logContent)) {
        $logContent = 'No upload log recorded yet.';
    } else {
        $lines = explode("\n", trim($logContent));
        $logContent = implode("\n", array_slice($lines, -40));
    }

    $tmpDir = sys_get_temp_dir();
    $tmpWritable = @is_writable($tmpDir);
    $emhttpWritable = @is_writable('/var/local/emhttp');
    $curUser = (function_exists('posix_getpwuid') && function_exists('posix_geteuid')) ? @posix_getpwuid(posix_geteuid())['name'] : 'unknown';

    json_output([
        'status' => 'success',
        'log' => $logContent,
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

    $cmd = "cd " . escapeshellarg($commonParent) . " && zip -r -q " . escapeshellarg($outZipPath) . " " . implode(' ', $relArgs);
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

    // 1. Check Unraid GPU Statistics plugin cached JSON (/tmp/gpustat.json)
    if (file_exists('/tmp/gpustat.json')) {
        $raw = @file_get_contents('/tmp/gpustat.json');
        if ($raw) {
            $json = @json_decode($raw, true);
            if (is_array($json) && !empty($json)) {
                $firstGpu = isset($json[0]) ? $json[0] : (isset($json['gpus'][0]) ? $json['gpus'][0] : $json);
                if (!empty($firstGpu['model']) || !empty($firstGpu['name'])) {
                    $mName = !empty($firstGpu['model']) ? $firstGpu['model'] : $firstGpu['name'];
                    $gpuData['name'] = $mName;
                    $gpuData['vendor'] = !empty($firstGpu['vendor']) ? $firstGpu['vendor'] : (stripos($mName, 'NVIDIA') !== false ? 'NVIDIA' : (stripos($mName, 'Intel') !== false ? 'Intel' : 'AMD'));
                    $gpuData['usage'] = isset($firstGpu['util']) ? (float)$firstGpu['util'] : (isset($firstGpu['usage']) ? (float)$firstGpu['usage'] : 0);
                    $gpuData['temp'] = isset($firstGpu['temp']) ? (int)$firstGpu['temp'] : null;
                    if (isset($firstGpu['memused']) && isset($firstGpu['memtotal'])) {
                        $gpuData['vram_used'] = (int)$firstGpu['memused'];
                        $gpuData['vram_total'] = (int)$firstGpu['memtotal'];
                        $gpuData['vram_pct'] = $gpuData['vram_total'] > 0 ? round(($gpuData['vram_used'] / $gpuData['vram_total']) * 100, 1) : 0;
                    }
                    if (isset($firstGpu['power'])) $gpuData['power_w'] = (float)$firstGpu['power'];
                    if (isset($firstGpu['clock'])) $gpuData['clock_mhz'] = (int)$firstGpu['clock'];
                    $gpuData['driver'] = 'gpustat';
                    return $gpuData;
                }
            }
        }
    }

    // 2. Check NVIDIA GPU via nvidia-smi
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
                return $gpuData;
            }
        }
    }

    // 3. Check Intel iGPU (QuickSync / i915) via sysfs and lspci
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
                        // Priority 1: Extract model in square brackets e.g. [UHD Graphics 770] or [Iris Xe Graphics]
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
                    if (!$intelName) $intelName = 'Intel® 核芯显卡 (iGPU)';
                    $gpuData['clean_name'] = $intelName;

                    // Read frequency
                    $curFreq = 0;
                    $maxFreq = 0;
                    $minFreq = 0;
                    $freqFiles = [
                        "{$card}/gt_cur_freq_mhz",
                        "{$card}/device/drm/{$card}/gt_cur_freq_mhz",
                    ];
                    foreach ($freqFiles as $ff) {
                        if (file_exists($ff)) { $curFreq = (int)trim(@file_get_contents($ff)); break; }
                    }
                    $maxFreqFiles = [
                        "{$card}/gt_max_freq_mhz",
                        "{$card}/device/drm/{$card}/gt_max_freq_mhz",
                    ];
                    foreach ($maxFreqFiles as $ff) {
                        if (file_exists($ff)) { $maxFreq = (int)trim(@file_get_contents($ff)); break; }
                    }
                    $minFreqFiles = [
                        "{$card}/gt_min_freq_mhz",
                        "{$card}/device/drm/{$card}/gt_min_freq_mhz",
                    ];
                    foreach ($minFreqFiles as $ff) {
                        if (file_exists($ff)) { $minFreq = (int)trim(@file_get_contents($ff)); break; }
                    }

                    $usage = 0;
                    if ($curFreq > 0 && $maxFreq > $minFreq) {
                        $usage = round((($curFreq - $minFreq) / ($maxFreq - $minFreq)) * 100, 1);
                        $usage = max(0, min(100, $usage));
                    }

                    $temp = null;
                    $hwmon = glob("{$card}/device/hwmon/hwmon*/temp1_input");
                    if ($hwmon && file_exists($hwmon[0])) {
                        $tRaw = (int)trim(@file_get_contents($hwmon[0]));
                        if ($tRaw > 0) $temp = round($tRaw / 1000);
                    }

                    $gpuData['name'] = $intelName;
                    $gpuData['vendor'] = 'Intel';
                    $gpuData['usage'] = $usage;
                    $gpuData['temp'] = $temp;
                    $gpuData['clock_mhz'] = $curFreq > 0 ? $curFreq : null;
                    $gpuData['max_clock_mhz'] = $maxFreq > 0 ? $maxFreq : null;
                    $gpuData['driver'] = 'i915';
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
                    $usage = file_exists($busyFile) ? (float)trim(@file_get_contents($busyFile)) : 0;

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
                    $gpuData['temp'] = $temp;
                    $gpuData['vram_used'] = $vramUsed;
                    $gpuData['vram_total'] = $vramTotal;
                    $gpuData['vram_pct'] = ($vramTotal > 0) ? round(($vramUsed / $vramTotal) * 100, 1) : 0;
                    $gpuData['driver'] = 'amdgpu';
                    return $gpuData;
                }
            }
        }
    }

    // 5. Generic display fallback via lspci
    $genLspci = @shell_exec("lspci 2>/dev/null | grep -iE 'vga compatible controller|3d controller|display controller'");
    if ($genLspci && trim($genLspci) !== '') {
        $firstLine = explode("\n", trim($genLspci))[0];
        if (preg_match('/:\s*(.+)$/', $firstLine, $m)) {
            $model = trim($m[1]);
            $vendor = (stripos($model, 'Intel') !== false) ? 'Intel' : ((stripos($model, 'NVIDIA') !== false) ? 'NVIDIA' : ((stripos($model, 'AMD') !== false || stripos($model, 'ATI') !== false) ? 'AMD' : 'Display'));
            $gpuData['name'] = $model;
            $gpuData['vendor'] = $vendor;
            $gpuData['driver'] = 'generic';
            return $gpuData;
        }
    }

    return $gpuData;
}

function handle_check_docker_updates() {
    @set_time_limit(180);
    @ini_set('max_execution_time', '180');

    $out = '';
    $scripts = [
        '/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate check',
        '/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/docker update',
        'php /usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate.php'
    ];
    foreach ($scripts as $cmd) {
        $bin = explode(' ', $cmd)[0];
        if (file_exists($bin)) {
            $out .= @shell_exec("{$cmd} 2>&1") . "\n";
        }
    }
    if (empty(trim($out))) {
        $out = @shell_exec('/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate check 2>&1');
    }

    @file_put_contents('/tmp/unraid_last_docker_update_check.txt', time());
    usleep(300000); // 300ms for file writes to flush

    // Re-read docker updates map
    $dockerUpdatesMap = get_docker_updates_map();

    // Accurately count unique containers that have updates available
    $updatesCount = 0;
    $rawDocker = @shell_exec('docker ps -a --format "{{.Names}}\t{{.Image}}" 2>/dev/null');
    if ($rawDocker) {
        $lines = explode("\n", trim($rawDocker));
        foreach ($lines as $line) {
            $parts = explode("\t", trim($line));
            $cName = isset($parts[0]) ? ltrim(trim($parts[0]), '/') : '';
            $cImage = isset($parts[1]) ? trim($parts[1]) : '';
            if (empty($cName)) continue;
            $hasUpdate = (
                !empty($dockerUpdatesMap[$cName]) ||
                !empty($dockerUpdatesMap[strtolower($cName)]) ||
                (!empty($cImage) && !empty($dockerUpdatesMap[$cImage])) ||
                (!empty($cImage) && !empty($dockerUpdatesMap[strtolower($cImage)]))
            );
            if ($hasUpdate) {
                $updatesCount++;
            }
        }
    }

    if ($updatesCount === 0 && !empty($dockerUpdatesMap)) {
        $unique = [];
        foreach (array_keys($dockerUpdatesMap) as $k) {
            $k = strtolower($k);
            if (strpos($k, '/') === false && strpos($k, ':') === false) {
                $unique[$k] = true;
            }
        }
        $updatesCount = count($unique);
    }

    json_output([
        'status' => 'success',
        'message' => $updatesCount > 0 ? "检测完成，发现 {$updatesCount} 个容器有可用更新！" : '检测完成，所有容器已是最新版本。',
        'updates_count' => $updatesCount,
        'update_count' => $updatesCount,
        'output' => trim($out)
    ]);
}

function handle_ca_apps() {
    $cat = isset($_GET['category']) ? trim($_GET['category']) : 'all';
    $search = isset($_GET['search']) ? trim($_GET['search']) : (isset($_GET['q']) ? trim($_GET['q']) : '');

    $apps = [];

    // 1. Attempt to read Unraid Community Applications local cache
    $caCacheFile = '/tmp/community.applications/tempFiles/templates.json';
    if (file_exists($caCacheFile)) {
        $raw = @file_get_contents($caCacheFile);
        if ($raw) {
            $decoded = @json_decode($raw, true);
            if (is_array($decoded)) {
                foreach ($decoded as $item) {
                    if (empty($item['Name']) && empty($item['name'])) continue;
                    $name = !empty($item['Name']) ? $item['Name'] : $item['name'];
                    $repo = !empty($item['Repository']) ? $item['Repository'] : (!empty($item['repository']) ? $item['repository'] : '');
                    $desc = !empty($item['Overview']) ? $item['Overview'] : (!empty($item['description']) ? $item['description'] : '');
                    $icon = !empty($item['Icon']) ? $item['Icon'] : (!empty($item['icon']) ? $item['icon'] : '');
                    $category = !empty($item['Category']) ? $item['Category'] : (!empty($item['category']) ? $item['category'] : 'Tools:');
                    $author = !empty($item['Author']) ? $item['Author'] : (!empty($item['author']) ? $item['author'] : 'Community');

                    $apps[] = [
                        'id' => md5($name . $repo),
                        'name' => $name,
                        'author' => $author,
                        'repository' => $repo,
                        'overview' => strip_tags($desc),
                        'icon' => $icon,
                        'category' => $category,
                    ];
                }
            }
        }
    }

    // 2. If CA cache is empty, provide curated high-quality Unraid Docker apps catalog
    if (empty($apps)) {
        $apps = get_default_curated_apps();
    }

    // Filter by search query
    if (!empty($search)) {
        $q = mb_strtolower($search, 'UTF-8');
        $apps = array_values(array_filter($apps, function($a) use ($q) {
            return (
                stripos($a['name'], $q) !== false ||
                stripos($a['overview'], $q) !== false ||
                stripos($a['author'], $q) !== false ||
                stripos($a['category'], $q) !== false
            );
        }));
    }

    // Filter by category
    if ($cat !== 'all') {
        $apps = array_values(array_filter($apps, function($a) use ($cat) {
            $c = strtolower($a['category']);
            if ($cat === 'media') return stripos($c, 'media') !== false || stripos($c, 'video') !== false || stripos($c, 'audio') !== false;
            if ($cat === 'download') return stripos($c, 'download') !== false || stripos($c, 'torrent') !== false;
            if ($cat === 'cloud') return stripos($c, 'cloud') !== false || stripos($c, 'backup') !== false || stripos($c, 'sync') !== false;
            if ($cat === 'network') return stripos($c, 'network') !== false || stripos($c, 'proxy') !== false || stripos($c, 'vpn') !== false;
            if ($cat === 'smarthome') return stripos($c, 'home') !== false || stripos($c, 'iot') !== false;
            if ($cat === 'tools') return stripos($c, 'tool') !== false || stripos($c, 'system') !== false;
            return true;
        }));
    }

    json_output([
        'status' => 'success',
        'total' => count($apps),
        'apps' => $apps
    ]);
}

function get_default_curated_apps() {
    return [
        [
            'id' => 'nextcloud',
            'name' => 'Nextcloud',
            'author' => 'linuxserver',
            'repository' => 'lscr.io/linuxserver/nextcloud:latest',
            'category' => 'Cloud:Backup',
            'category_label' => '私有云盘',
            'icon' => 'https://raw.githubusercontent.com/linuxserver/docker-templates/master/linuxserver.io/img/nextcloud-logo.png',
            'overview' => '行业领先的安全私有云存储中心，支持文件同步、在线文档、多端相册备份及企业级安全协作。',
            'default_port' => 443
        ],
        [
            'id' => 'plex',
            'name' => 'Plex Media Server',
            'author' => 'linuxserver',
            'repository' => 'lscr.io/linuxserver/plex:latest',
            'category' => 'Media:Video',
            'category_label' => '影音媒体',
            'icon' => 'https://raw.githubusercontent.com/linuxserver/docker-templates/master/linuxserver.io/img/plex-logo.png',
            'overview' => '全球广泛使用的影音服务器，自动刮削电影电视海报字幕，支持全平台硬件实时转码与远程推流。',
            'default_port' => 32400
        ],
        [
            'id' => 'jellyfin',
            'name' => 'Jellyfin',
            'author' => 'linuxserver',
            'repository' => 'lscr.io/linuxserver/jellyfin:latest',
            'category' => 'Media:Video',
            'category_label' => '影音媒体',
            'icon' => 'https://raw.githubusercontent.com/linuxserver/docker-templates/master/linuxserver.io/img/jellyfin-logo.png',
            'overview' => '100% 自由开源且零订阅的家庭影院媒体中枢，原生支持 Intel QuickSync 及硬件级 HDR 色调映射。',
            'default_port' => 8096
        ],
        [
            'id' => 'emby',
            'name' => 'Emby Server',
            'author' => 'emby',
            'repository' => 'emby/embyserver:latest',
            'category' => 'Media:Video',
            'category_label' => '影音媒体',
            'icon' => 'https://raw.githubusercontent.com/linuxserver/docker-templates/master/linuxserver.io/img/emby-icon.png',
            'overview' => '性能强悍的个人媒体服务器，支持精细化的多用户权限控制、Live TV 电视录制与流畅硬件转码。',
            'default_port' => 8096
        ],
        [
            'id' => 'qbittorrent',
            'name' => 'qBittorrent',
            'author' => 'linuxserver',
            'repository' => 'lscr.io/linuxserver/qbittorrent:latest',
            'category' => 'Download:Torrent',
            'category_label' => '下载工具',
            'icon' => 'https://raw.githubusercontent.com/linuxserver/docker-templates/master/linuxserver.io/img/qbittorrent-logo.png',
            'overview' => 'PT/BT 下载神器，内置完善的 WebUI 界面、RSS 订阅自动下载、限速调度与高级种子分类管理。',
            'default_port' => 8080
        ],
        [
            'id' => 'transmission',
            'name' => 'Transmission',
            'author' => 'linuxserver',
            'repository' => 'lscr.io/linuxserver/transmission:latest',
            'category' => 'Download:Torrent',
            'category_label' => '下载工具',
            'icon' => 'https://raw.githubusercontent.com/linuxserver/docker-templates/master/linuxserver.io/img/transmission-logo.png',
            'overview' => '超轻量级 BT 客户端，内存开销极小，极其适合 24 小时低功耗保种与海量种子挂机。',
            'default_port' => 9091
        ],
        [
            'id' => 'nginx-proxy-manager',
            'name' => 'Nginx Proxy Manager',
            'author' => 'jc21',
            'repository' => 'jc21/nginx-proxy-manager:latest',
            'category' => 'Network:Proxy',
            'category_label' => '网络安全',
            'icon' => 'https://raw.githubusercontent.com/NginxProxyManager/nginx-proxy-manager/develop/frontend/images/logo.png',
            'overview' => '极简优雅的反向代理控制面板，支持一键自动申请部署 Let\'s Encrypt SSL 免费泛域名证书与访问控制。',
            'default_port' => 81
        ],
        [
            'id' => 'adguardhome',
            'name' => 'AdGuard Home',
            'author' => 'adguard',
            'repository' => 'adguard/adguardhome:latest',
            'category' => 'Network:Security',
            'category_label' => '网络安全',
            'icon' => 'https://raw.githubusercontent.com/AdguardTeam/AdGuardHome/master/client/src/assets/logo.svg',
            'overview' => '局域网全网级 DNS 广告拦截与隐私卫士，支持 DoH / DoT 加密解析、父母控制与全设备跟踪保护。',
            'default_port' => 3000
        ],
        [
            'id' => 'vaultwarden',
            'name' => 'Vaultwarden',
            'author' => 'dani-garcia',
            'repository' => 'vaultwarden/server:latest',
            'category' => 'Network:Security',
            'category_label' => '网络安全',
            'icon' => 'https://raw.githubusercontent.com/dani-garcia/vaultwarden/main/resources/vaultwarden-icon.svg',
            'overview' => '基于 Rust 轻量重构的 Bitwarden 开源密码管理器后端，安全保管账号密码、二步验证码与信用卡信息。',
            'default_port' => 80
        ],
        [
            'id' => 'homeassistant',
            'name' => 'Home Assistant',
            'author' => 'homeassistant',
            'repository' => 'ghcr.io/home-assistant/home-assistant:stable',
            'category' => 'Home:IoT',
            'category_label' => '智能家居',
            'icon' => 'https://brands.home-assistant.io/homeassistant/icon.png',
            'overview' => '全球第一的开源智能家居控制中心，整合米家、Apple HomeKit、Matter、Zigbee 与各类传感器联动。',
            'default_port' => 8123
        ],
        [
            'id' => 'uptime-kuma',
            'name' => 'Uptime Kuma',
            'author' => 'louislam',
            'repository' => 'louislam/uptime-kuma:latest',
            'category' => 'Tools:System',
            'category_label' => '系统工具',
            'icon' => 'https://raw.githubusercontent.com/louislam/uptime-kuma/master/public/icon.svg',
            'overview' => '高颜值自建服务运行状态监控站，支持 HTTP、TCP、Ping、DNS 探针，并提供多通道异常消息推送。',
            'default_port' => 3001
        ],
        [
            'id' => 'immich',
            'name' => 'Immich',
            'author' => 'immich-app',
            'repository' => 'ghcr.io/immich-app/immich-server:release',
            'category' => 'Cloud:Backup',
            'category_label' => '私有云盘',
            'icon' => 'https://immich.app/img/immich-logo.svg',
            'overview' => '高性能自建相册备份方案（Google Photos 完美替代品），原生移动端极速自动备份、AI 人脸与目标识别。',
            'default_port' => 2283
        ],
        [
            'id' => 'photoprism',
            'name' => 'PhotoPrism',
            'author' => 'photoprism',
            'repository' => 'photoprism/photoprism:latest',
            'category' => 'Cloud:Backup',
            'category_label' => '私有云盘',
            'icon' => 'https://raw.githubusercontent.com/photoprism/photoprism/develop/assets/static/img/app/favicon.png',
            'overview' => '基于 TensorFlow AI 图像驱动的个人相册引擎，支持自动地图定位、人脸归类及时间线浏览。',
            'default_port' => 2342
        ],
        [
            'id' => 'tailscale',
            'name' => 'Tailscale',
            'author' => 'tailscale',
            'repository' => 'tailscale/tailscale:latest',
            'category' => 'Network:VPN',
            'category_label' => '网络安全',
            'icon' => 'https://tailscale.com/favicon.ico',
            'overview' => '基于 WireGuard 协议构建的安全零配置虚拟局域网（Mesh VPN），轻松实现异地多设备点对点直连。',
            'default_port' => 41641
        ],
        [
            'id' => 'cloudflared',
            'name' => 'Cloudflare Tunnel',
            'author' => 'cloudflare',
            'repository' => 'cloudflare/cloudflared:latest',
            'category' => 'Network:Proxy',
            'category_label' => '网络安全',
            'icon' => 'https://www.cloudflare.com/favicon.ico',
            'overview' => '无需公网 IP 与路由端口映射，安全将 Unraid 内网服务无缝发布穿透到全球互联网。',
            'default_port' => 80
        ],
        [
            'id' => 'portainer',
            'name' => 'Portainer CE',
            'author' => 'portainer',
            'repository' => 'portainer/portainer-ce:latest',
            'category' => 'Tools:System',
            'category_label' => '系统工具',
            'icon' => 'https://raw.githubusercontent.com/portainer/portainer/develop/app/assets/ico/favicon.ico',
            'overview' => '强大的轻量级 Docker 图形化管理容器仪表板，便捷管理镜像、网络、数据卷与多节点集群。',
            'default_port' => 9000
        ],
        [
            'id' => 'homarr',
            'name' => 'Homarr',
            'author' => 'ajnart',
            'repository' => 'ghcr.io/ajnart/homarr:latest',
            'category' => 'Tools:System',
            'category_label' => '系统工具',
            'icon' => 'https://homarr.dev/img/logo.png',
            'overview' => '现代美观的定制化 NAS 导航主页，深度集成 Docker、qBittorrent、Plex 实时状态小组件。',
            'default_port' => 7575
        ],
        [
            'id' => 'homepage',
            'name' => 'Homepage',
            'author' => 'gethomepage',
            'repository' => 'ghcr.io/gethomepage/homepage:latest',
            'category' => 'Tools:System',
            'category_label' => '系统工具',
            'icon' => 'https://gethomepage.dev/img/logo.png',
            'overview' => '极简高效且高度可定制的自建导航面板，以 YAML 驱动，支持 100+ 项流行自建服务集成。',
            'default_port' => 3000
        ],
        [
            'id' => 'calibre-web',
            'name' => 'Calibre-Web',
            'author' => 'linuxserver',
            'repository' => 'lscr.io/linuxserver/calibre-web:latest',
            'category' => 'Media:Books',
            'category_label' => '影音媒体',
            'icon' => 'https://raw.githubusercontent.com/linuxserver/docker-templates/master/linuxserver.io/img/calibre-web-logo.png',
            'overview' => '干净整洁的私人在线数字图书馆，支持在线阅读 EPUB/PDF、图书元数据刮削及一键推送到 Kindle。',
            'default_port' => 8083
        ],
        [
            'id' => 'audiobookshelf',
            'name' => 'Audiobookshelf',
            'author' => 'advplyr',
            'repository' => 'ghcr.io/advplyr/audiobookshelf:latest',
            'category' => 'Media:Audio',
            'category_label' => '影音媒体',
            'icon' => 'https://raw.githubusercontent.com/advplyr/audiobookshelf/master/client/static/icon.png',
            'overview' => '专为有声读物与播客打造的流媒体服务器，支持多端收听进度自动云同步与离线章节下载。',
            'default_port' => 13378
        ],
        [
            'id' => 'navidrome',
            'name' => 'Navidrome',
            'author' => 'deluan',
            'repository' => 'deluan/navidrome:latest',
            'category' => 'Media:Audio',
            'category_label' => '影音媒体',
            'icon' => 'https://raw.githubusercontent.com/navidrome/navidrome/master/resources/logo-192x192.png',
            'overview' => '轻量超速的个人音乐流媒体服务器，完美兼容 Subsonic 移动客户端协议，支持无损 FLAC 串流。',
            'default_port' => 4533
        ],
        [
            'id' => 'stirling-pdf',
            'name' => 'Stirling-PDF',
            'author' => 'frooodle',
            'repository' => 'frooodle/s-pdf:latest',
            'category' => 'Tools:Productivity',
            'category_label' => '系统工具',
            'icon' => 'https://raw.githubusercontent.com/Frooodle/Stirling-PDF/main/src/main/resources/static/favicon.ico',
            'overview' => '功能强大的本地离线 PDF 多功能工具箱，支持合并、拆分、OCR 识别、旋转、密码保护与页面提取。',
            'default_port' => 8080
        ],
        [
            'id' => 'it-tools',
            'name' => 'IT-Tools',
            'author' => 'corentinth',
            'repository' => 'corentinth/it-tools:latest',
            'category' => 'Tools:Productivity',
            'category_label' => '系统工具',
            'icon' => 'https://it-tools.tech/favicon-32x32.png',
            'overview' => '开发人员与系统运维的百宝箱应用集合，包含编解码、时间戳转换、二维码生成、哈希比对等数十项实用工具。',
            'default_port' => 80
        ],
        [
            'id' => 'syncthing',
            'name' => 'Syncthing',
            'author' => 'linuxserver',
            'repository' => 'lscr.io/linuxserver/syncthing:latest',
            'category' => 'Cloud:Sync',
            'category_label' => '私有云盘',
            'icon' => 'https://raw.githubusercontent.com/linuxserver/docker-templates/master/linuxserver.io/img/syncthing-logo.png',
            'overview' => '持续点对点去中心化加密同步工具，无需中继服务器，安全保护多台电脑与手机间的数据一致性。',
            'default_port' => 8384
        ]
    ];
}


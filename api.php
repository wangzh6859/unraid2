<?php
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

// Comprehensive shutdown handler: if script terminates prematurely or with fatal error, ALWAYS return JSON
register_shutdown_function(function() {
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
    if (ob_get_length() === 0 && !headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
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
define('CONFIG_TOKEN_FILE', '/boot/config/plugins/unraid_api_token.txt');
define('FALLBACK_TOKEN', 'unraid2026');

function get_valid_tokens() {
    $tokens = [FALLBACK_TOKEN];
    if (file_exists(CONFIG_TOKEN_FILE)) {
        $custom = trim(file_get_contents(CONFIG_TOKEN_FILE));
        if (!empty($custom)) {
            $tokens[] = $custom;
        }
    }
    return $tokens;
}

function verify_auth() {
    $reqToken = '';
    if (isset($_GET['token'])) {
        $reqToken = trim($_GET['token']);
    } elseif (isset($_POST['token'])) {
        $reqToken = trim($_POST['token']);
    } elseif (isset($_SERVER['HTTP_X_API_TOKEN'])) {
        $reqToken = trim($_SERVER['HTTP_X_API_TOKEN']);
    } elseif (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        if (preg_match('/Bearer\s+(\S+)/i', $_SERVER['HTTP_AUTHORIZATION'], $m)) {
            $reqToken = trim($m[1]);
        }
    }

    $validTokens = get_valid_tokens();
    if (empty($reqToken) || !in_array($reqToken, $validTokens, true)) {
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

$action = isset($_GET['action']) ? trim($_GET['action']) : (isset($_POST['action']) ? trim($_POST['action']) : 'status');

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

    case 'start_vm':
    case 'stop_vm':
    case 'restart_vm':
        handle_vm_action($action);
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

    default:
        json_output(['status' => 'error', 'message' => "Unknown action: {$action}"], 400);
        break;
}

// -------------------------------------------------------------
// Helper Output Function
// -------------------------------------------------------------
function json_output($data, $code = 200) {
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
    $meminfo = @file_get_contents('/proc/meminfo');
    if ($meminfo) {
        preg_match('/MemTotal:\s+(\d+)\s+kB/', $meminfo, $totalMatches);
        preg_match('/MemAvailable:\s+(\d+)\s+kB/', $meminfo, $availMatches);
        if (isset($totalMatches[1]) && isset($availMatches[1])) {
            $memTotal = $totalMatches[1];
            $memAvail = $availMatches[1];
            $memUsage = round((($memTotal - $memAvail) / $memTotal) * 100, 1);
        }
    }

    // 3. GPU Usage (NVIDIA or Intel)
    $gpuData = ['name' => 'N/A', 'usage' => 0];
    $nvidiaSmi = @shell_exec('nvidia-smi --query-gpu=name,utilization.gpu --format=csv,noheader,nounits 2>/dev/null');
    if ($nvidiaSmi && trim($nvidiaSmi) !== '') {
        $parts = explode(',', trim($nvidiaSmi));
        if (count($parts) >= 2) {
            $gpuData = ['name' => trim($parts[0]), 'usage' => (float)trim($parts[1])];
        }
    }

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
                        'is_parity' => true
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

                    $disks[] = [
                        'name' => $name,
                        'device' => $dev,
                        'size' => $size,
                        'total' => $size,
                        'used' => $used,
                        'percentage' => $pct,
                        'temp' => $temp,
                        'status' => $status,
                        'smart_status' => $smartStatus
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

    $dockerPs = @shell_exec('docker ps -a --format "{{.Names}}\t{{.Status}}\t{{.ID}}" 2>/dev/null');
    if ($dockerPs) {
        $lines = explode("\n", trim($dockerPs));
        foreach ($lines as $line) {
            $cols = explode("\t", $line);
            if (count($cols) >= 2 && !empty($cols[0])) {
                $cName = trim($cols[0]);
                $cleanName = ltrim($cName, '/');
                $cId = isset($cols[2]) ? trim($cols[2]) : '';
                $cStatus = (strpos($cols[1], 'Up') === 0) ? 'running' : 'stopped';
                
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
                    'mem' => $memStr
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
                    $vState = ($cols[2] === 'running') ? 'running' : 'shut off';
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

    json_output([
        'stats' => ['cpu' => $cpuUsage, 'memory' => $memUsage],
        'gpu' => $gpuData,
        'storage' => [
            'percentage' => $storagePercentage,
            'total_used' => $totalArrayUsed,
            'total_size' => $totalArraySize,
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
            'tx_bytes' => $netTx
        ],
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

function handle_vm_action($action) {
    $target = isset($_GET['target']) ? escapeshellarg($_GET['target']) : '';
    if (empty($target)) {
        json_output(['status' => 'error', 'message' => 'Missing target VM'], 400);
    }
    $cmd = '';
    if ($action === 'start_vm') $cmd = "virsh start {$target}";
    elseif ($action === 'stop_vm') $cmd = "virsh shutdown {$target}";
    elseif ($action === 'restart_vm') $cmd = "virsh reboot {$target}";
    
    $out = shell_exec($cmd . ' 2>&1');
    json_output(['status' => 'success', 'message' => "VM action {$action} executed", 'output' => trim($out)]);
}

function handle_smart_info() {
    $rawTarget = isset($_GET['target']) ? trim($_GET['target']) : '';
    $rawName = isset($_GET['name']) ? trim($_GET['name']) : '';
    if (empty($rawTarget) && empty($rawName)) {
        json_output(['status' => 'error', 'message' => 'Missing disk device name'], 400);
    }

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

        $bytesWritten = 0;
        while ($buff = fread($in, 65536)) {
            $bytesWritten += fwrite($out, $buff);
        }
        @fclose($in);
        @fclose($out);

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
            if (!is_array($payload)) {
                $payload = array_merge($_GET, $_POST);
            }
            $base64Data = isset($payload['data']) ? $payload['data'] : '';
            $binaryData = ($base64Data !== '') ? base64_decode($base64Data) : '';
            log_upload_debug("chunk_mode: json_base64, rawLen=" . strlen((string)$rawInput) . " binLen=" . strlen($binaryData));
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

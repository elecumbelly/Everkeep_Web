<?php
declare(strict_types=1);

function loadEnvFile(string $path): void
{
    if (!is_readable($path)) {
        return;
    }

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        if (strpos($line, '=') === false) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value);
        $value = trim($value, "\"'");
        if ($key === '') {
            continue;
        }
        if (getenv($key) === false) {
            putenv($key . '=' . $value);
            $_ENV[$key] = $value;
        }
    }
}

function loadEnv(): void
{
    $paths = [
        __DIR__ . '/../.env',
        __DIR__ . '/.env',
        __DIR__ . '/../../.env'
    ];

    foreach ($paths as $path) {
        loadEnvFile($path);
    }
}

function dbConfig(): array
{
    loadEnv();

    return [
        'host' => getenv('DB_HOST') ?: 'localhost',
        'port' => getenv('DB_PORT') ?: '3306',
        'name' => getenv('DB_NAME') ?: '',
        'user' => getenv('DB_USER') ?: '',
        'pass' => getenv('DB_PASSWORD') ?: '',
        'charset' => getenv('DB_CHARSET') ?: 'utf8mb4'
    ];
}

function db(): PDO
{
    $cfg = dbConfig();
    if (!$cfg['name'] || !$cfg['user']) {
        throw new RuntimeException('Database configuration is missing.');
    }

    $dsn = sprintf(
        'mysql:host=%s;port=%s;dbname=%s;charset=%s',
        $cfg['host'],
        $cfg['port'],
        $cfg['name'],
        $cfg['charset']
    );

    return new PDO($dsn, $cfg['user'], $cfg['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);
}

function jsonResponse(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload);
    exit;
}

function readJsonBody(): array
{
    $raw = file_get_contents('php://input');
    if (!$raw) {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function getOwnerKey(array $data): string
{
    $key = '';
    if (isset($data['ownerKey'])) {
        $key = (string) $data['ownerKey'];
    } elseif (isset($_GET['ownerKey'])) {
        $key = (string) $_GET['ownerKey'];
    }
    $key = preg_replace('/[^a-zA-Z0-9_-]/', '', $key);
    return substr($key, 0, 64);
}

function allowCors(): void
{
    $origin = allowedOrigin();
    if ($origin) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
}

function allowedOrigin(): ?string
{
    loadEnv();
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return null;
    }
    $allowed = envList('ALLOWED_ORIGINS');
    if (!$allowed) {
        return null;
    }
    return in_array($origin, $allowed, true) ? $origin : null;
}

function envList(string $key): array
{
    $raw = getenv($key) ?: '';
    if ($raw === '') {
        return [];
    }
    $parts = array_map('trim', explode(',', $raw));
    return array_values(array_filter($parts, static fn ($part) => $part !== ''));
}

function maxBodyBytes(): int
{
    loadEnv();
    $limit = getenv('MAX_BODY_BYTES');
    if ($limit === false || !is_numeric($limit)) {
        return 5242880;
    }
    return max(1024, (int) $limit);
}

function rateLimitConfig(): array
{
    loadEnv();
    $limit = getenv('RATE_LIMIT_REQUESTS');
    $window = getenv('RATE_LIMIT_WINDOW');
    return [
        'limit' => $limit !== false && is_numeric($limit) ? (int) $limit : 120,
        'window' => $window !== false && is_numeric($window) ? (int) $window : 300
    ];
}

function rateLimitKey(string $ownerKey = ''): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $value = $ip . ':' . $ownerKey;
    return hash('sha256', $value);
}

function checkRateLimit(string $key, int $limit, int $windowSeconds): bool
{
    $path = sys_get_temp_dir() . '/everkeep_rl_' . $key;
    $now = time();
    $data = ['count' => 0, 'start' => $now];
    if (is_readable($path)) {
        $raw = file_get_contents($path);
        $decoded = json_decode((string) $raw, true);
        if (is_array($decoded) && isset($decoded['count'], $decoded['start'])) {
            $data['count'] = (int) $decoded['count'];
            $data['start'] = (int) $decoded['start'];
        }
    }
    if (($now - $data['start']) >= $windowSeconds) {
        $data = ['count' => 0, 'start' => $now];
    }
    $data['count'] += 1;
    file_put_contents($path, json_encode($data), LOCK_EX);
    return $data['count'] <= $limit;
}

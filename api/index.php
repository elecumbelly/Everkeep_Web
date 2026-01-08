<?php
declare(strict_types=1);

require __DIR__ . '/db.php';

allowCors();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin && !allowedOrigin()) {
    jsonResponse(['ok' => false, 'error' => 'origin_not_allowed'], 403);
}

header('Cache-Control: no-store');

$action = isset($_GET['action']) ? strtolower((string) $_GET['action']) : '';

try {
    $pdo = db();
} catch (Throwable $error) {
    jsonResponse(['ok' => false, 'error' => 'database_unavailable'], 500);
}

if ($action === 'ping') {
    jsonResponse(['ok' => true, 'time' => gmdate('c')]);
}

if ($action === 'backup') {
    $data = readJsonBodyLimited();
    $ownerKey = getOwnerKey($data);
    if ($ownerKey === '') {
        jsonResponse(['ok' => false, 'error' => 'missing_owner_key'], 400);
    }

    enforceRateLimit($ownerKey);

    $state = sanitiseState($data['state'] ?? null);
    if ($state === null) {
        jsonResponse(['ok' => false, 'error' => 'invalid_state'], 400);
    }

    $clientUpdatedAt = isset($data['clientUpdatedAt']) ? (int) $data['clientUpdatedAt'] : 0;
    if ($clientUpdatedAt <= 0) {
        $clientUpdatedAt = (int) round(microtime(true) * 1000);
    }

    $stmt = $pdo->prepare('SELECT client_updated_at FROM everkeep_backups WHERE owner_key = ?');
    $stmt->execute([$ownerKey]);
    $existing = $stmt->fetch();

    if ($existing && $clientUpdatedAt < (int) $existing['client_updated_at']) {
        jsonResponse([
            'ok' => true,
            'status' => 'ignored',
            'serverClientUpdatedAt' => (int) $existing['client_updated_at']
        ]);
    }

    $payload = json_encode($state);
    $stmt = $pdo->prepare(
        'INSERT INTO everkeep_backups (owner_key, state_json, client_updated_at) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), client_updated_at = VALUES(client_updated_at), updated_at = CURRENT_TIMESTAMP'
    );
    $stmt->execute([$ownerKey, $payload, $clientUpdatedAt]);

    jsonResponse([
        'ok' => true,
        'status' => 'saved',
        'clientUpdatedAt' => $clientUpdatedAt
    ]);
}

if ($action === 'restore') {
    $data = readJsonBodyLimited();
    $ownerKey = getOwnerKey($data);
    if ($ownerKey === '') {
        jsonResponse(['ok' => false, 'error' => 'missing_owner_key'], 400);
    }

    enforceRateLimit($ownerKey);

    $stmt = $pdo->prepare('SELECT state_json, client_updated_at, updated_at FROM everkeep_backups WHERE owner_key = ?');
    $stmt->execute([$ownerKey]);
    $row = $stmt->fetch();

    if (!$row) {
        jsonResponse(['ok' => true, 'state' => null]);
    }

    $state = json_decode($row['state_json'], true);

    jsonResponse([
        'ok' => true,
        'state' => $state,
        'clientUpdatedAt' => (int) $row['client_updated_at'],
        'serverUpdatedAt' => $row['updated_at']
    ]);
}

jsonResponse(['ok' => false, 'error' => 'unknown_action'], 400);

function readJsonBodyLimited(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    if (strlen($raw) > maxBodyBytes()) {
        jsonResponse(['ok' => false, 'error' => 'payload_too_large'], 413);
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function enforceRateLimit(string $ownerKey): void
{
    $config = rateLimitConfig();
    $key = rateLimitKey($ownerKey);
    if (!checkRateLimit($key, $config['limit'], $config['window'])) {
        jsonResponse(['ok' => false, 'error' => 'rate_limited'], 429);
    }
}

function sanitiseState($state): ?array
{
    if (!is_array($state)) {
        return null;
    }

    $lists = [
        'memories' => 5000,
        'sections' => 200,
        'people' => 2000,
        'places' => 2000
    ];

    $clean = [
        'memories' => [],
        'sections' => [],
        'people' => [],
        'places' => [],
        'settings' => [],
        'flags' => []
    ];

    foreach ($lists as $key => $limit) {
        $value = $state[$key] ?? [];
        if (!is_array($value)) {
            return null;
        }
        if (count($value) > $limit) {
            return null;
        }
        $clean[$key] = array_values($value);
    }

    if (isset($state['settings']) && is_array($state['settings'])) {
        $clean['settings'] = $state['settings'];
    }
    if (isset($state['flags']) && is_array($state['flags'])) {
        $clean['flags'] = $state['flags'];
    }

    return $clean;
}

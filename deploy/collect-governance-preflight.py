"""Fetch only bounded chunks of the fixed, credential-free read-only plan via SSM."""
import base64
import gzip
import hashlib
import json
import os
import re
import shlex
import subprocess
import time
from pathlib import Path


def collect(result, invoke):
    report = next(json.loads(line) for line in result['Output'].splitlines() if line.startswith('{'))
    transport = report['planTransport']
    assert set(transport) == {'directory', 'sha256', 'size', 'chunkSize', 'partCount'}
    directory = transport['directory']
    assert re.fullmatch(r'/tmp/vendure-production-operations\.[A-Za-z0-9]+', directory)
    expected_hash = transport['sha256']
    assert re.fullmatch(r'[a-f0-9]{64}', expected_hash)
    assert isinstance(transport['size'], int) and 0 < transport['size'] <= 512000
    assert transport['chunkSize'] == 12000
    assert transport['partCount'] == (transport['size'] + 11999) // 12000
    helper = shlex.quote(directory + '/governance-preflight-transport.cjs')
    chunks = []
    try:
        for part in range(transport['partCount']):
            response = invoke(f'/usr/bin/node {helper} read {expected_hash} {part}')
            chunk = json.loads(response)
            assert set(chunk) == {'part', 'content', 'sha256'} and chunk['part'] == part
            content = chunk['content']
            assert isinstance(content, str) and 0 < len(content) <= 12000
            assert re.fullmatch(r'[A-Za-z0-9+/]+={0,2}', content)
            assert hashlib.sha256(content.encode()).hexdigest() == chunk['sha256']
            chunks.append(content)
        encoded = ''.join(chunks)
        assert len(encoded) == transport['size']
        assert hashlib.sha256(encoded.encode()).hexdigest() == expected_hash
        plan_bytes = gzip.decompress(base64.b64decode(encoded, validate=True))
        assert hashlib.sha256(plan_bytes).hexdigest() == report['audit']['snapshotHash']
        plan = json.loads(plan_bytes)
        assert plan['mode'] == 'READ_ONLY' and plan['productionApply'] is False
        return plan
    finally:
        assert invoke(f'/usr/bin/node {helper} cleanup {expected_hash}') == 'GOVERNANCE_TRANSPORT_CLEANED\n'


def invoke_ssm(command):
    common = ['--region', os.environ['AWS_REGION']]
    sent = subprocess.run(['aws', 'ssm', 'send-command', *common,
        '--document-name', 'AWS-RunShellScript', '--instance-ids', os.environ['INSTANCE_ID'],
        '--comment', 'Vendure fixed governance plan artifact transport',
        '--parameters', json.dumps({'commands': [command], 'executionTimeout': ['60']}),
        '--timeout-seconds', '60', '--query', 'Command.CommandId', '--output', 'text'],
        check=True, capture_output=True, text=True).stdout.strip()
    assert re.fullmatch(r'[a-f0-9-]{36}', sent)
    for _ in range(24):
        response = subprocess.run(['aws', 'ssm', 'get-command-invocation', *common,
            '--command-id', sent, '--instance-id', os.environ['INSTANCE_ID'], '--output', 'json'],
            capture_output=True, text=True)
        if response.returncode == 0:
            result = json.loads(response.stdout)
            status = result['Status']
            if status == 'Success':
                assert result['ResponseCode'] == 0
                return result['StandardOutputContent']
            assert status not in {'Failed', 'Cancelled', 'TimedOut', 'Cancelling'}, 'Fixed plan artifact transport failed'
        time.sleep(5)
    raise RuntimeError('Fixed plan artifact transport timed out')


if __name__ == '__main__':
    output = Path(os.environ['RUNNER_TEMP'])
    result = json.loads((output / 'production-operations-result.json').read_text())
    plan = collect(result, invoke_ssm)
    (output / 'platform-governance-data-plan.json').write_text(json.dumps(plan, indent=2) + '\n')

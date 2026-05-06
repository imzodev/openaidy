#!/usr/bin/env python3
import json, urllib.request

with open('/home/node/.openclaw/workspace/.github-token.json') as f:
    token = json.load(f)['token']

# Check existing PRs for this branch
req = urllib.request.Request(
    'https://api.github.com/repos/imzodev/openaidy/pulls?head=imzodev:feat/preset-choices-tool&state=open',
    headers={
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    },
    method='GET'
)
try:
    with urllib.request.urlopen(req) as resp:
        results = json.loads(resp.read())
    if results:
        pr = results[0]
        print(f"PR already exists: {pr['html_url']}")
        print(f"PR #{pr['number']} | State: {pr['state']}")
    else:
        print("No open PR for this branch, creating...")
        with open('/home/node/.openclaw/workspace/openaidy/.pr-payload.json') as f:
            payload = json.load(f)
        data = json.dumps(payload).encode()
        req2 = urllib.request.Request(
            'https://api.github.com/repos/imzodev/openaidy/pulls',
            data=data,
            headers={
                'Authorization': f'Bearer {token}',
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
            method='POST'
        )
        with urllib.request.urlopen(req2) as resp:
            pr = json.loads(resp.read())
            print(f"PR created: {pr['html_url']}")
            print(f"PR #{pr['number']}")
except Exception as e:
    print(f"Error: {e}")
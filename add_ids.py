#!/usr/bin/env python3
"""Add a numeric id to any row in a deck CSV that doesn't have one yet.

Existing ids are left alone. Rows missing one get the next free number
(continuing after the highest id already used, so nothing collides).
Works whether the file has a "front,back" header or none at all.
Edits the file in place; writes a "<file>.bak" backup first, just in case.

Usage:
    python3 add_ids.py decks/deck1.csv
"""
import csv
import shutil
import sys


def add_ids(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        rows = list(csv.reader(f))

    has_header = rows and [c.strip().lower() for c in rows[0][:2]] == ['front', 'back']
    data = rows[1:] if has_header else rows

    # Highest id already in use, so new ones never collide with it.
    next_id = 1
    for row in data:
        if len(row) >= 3 and row[2].strip().isdigit():
            next_id = max(next_id, int(row[2].strip()) + 1)

    out = []
    for row in data:
        front, back = row[0], row[1]
        existing = row[2].strip() if len(row) >= 3 else ''
        if existing:
            out.append([front, back, existing])
        else:
            out.append([front, back, str(next_id)])
            next_id += 1

    shutil.copyfile(path, path + '.bak')
    with open(path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['front', 'back', 'id'])
        writer.writerows(out)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: python3 add_ids.py <deck.csv>')
        sys.exit(1)
    add_ids(sys.argv[1])
    print(f'Done — ids added to {sys.argv[1]} (backup saved as {sys.argv[1]}.bak)')

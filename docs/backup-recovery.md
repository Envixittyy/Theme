# Backup and recovery

## What has to survive

| Data | Where | Recoverable without a backup? |
| --- | --- | --- |
| Tasks, courses, notes, announcements, sync state, audit trail | PostgreSQL | No — this is the product |
| Attachment bytes | S3 bucket or `LOCAL_STORAGE_DIR` | No |
| Encryption keys (`SECRET_ENCRYPTION_KEYS`) | Secret manager | **No — and without them the encrypted integration secrets in the database are unreadable** |
| VAPID keys | Secret manager | Regenerable, but every device must re-subscribe |
| Notion OAuth client | Notion | Regenerable; every user must reconnect |
| Blackboard feed URLs | Encrypted in the database | Users can paste them again, but only if they still have them |

The one that surprises people is the third row. A database backup restored
without the matching encryption key gives you every task and note intact and
every integration credential permanently unreadable. Back up the keyring
wherever you back up the database, and test that pairing.

## Database backups

```bash
# nightly
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" \
  > "backup-$(date +%F).dump"
```

Point-in-time recovery (WAL archiving, or the managed equivalent) is worth
having: the failure this system is most likely to see is a bad migration or a
mistaken bulk operation, and PITR is what turns that from a day of lost work
into a few minutes.

Retention that has proved sufficient: nightly for 30 days, weekly for 3 months,
one monthly for a year. Encrypt the backups at rest; they contain the same
ciphertext your database does, plus everything the student wrote.

## Attachments

**S3-compatible:** enable bucket versioning and a lifecycle rule. Versioning is
what protects against an accidental delete, which a replicated bucket does not.

**Local storage:** `LOCAL_STORAGE_DIR` is an ordinary directory of opaque keys.
Back it up with the filesystem, and back it up *with* the database — an
attachment row without its object is a broken link, and an object without its
row is unreachable garbage.

## Restore drill

Worth running once, before you need it.

```bash
createdb school_os_restore
pg_restore --no-owner --dbname school_os_restore backup-2026-08-26.dump

DATABASE_URL=postgres://…/school_os_restore \
SECRET_ENCRYPTION_KEYS=<the keyring from that period> \
  npm run db:migrate          # replays anything newer than the dump

DATABASE_URL=postgres://…/school_os_restore npm start
```

Then check four things, in this order, because each is a different failure mode:

1. **Sign in.** Sessions are in the database; old ones survive a restore.
2. **Open a task with attachments** and download one — proves the storage
   backup and the database backup are from a compatible moment.
3. **Settings → Integrations, press Sync now** — proves the encryption keyring
   still decrypts the stored secrets. This is the step that catches a missing
   key, and it catches it in a drill instead of in an incident.
4. **Settings → Sync health** — confirm the run recorded and no unexpected
   conflicts appeared.

## Rotating the encryption keyring

Rotation is a deploy, not a migration:

```bash
# 1. generate a new key
node -e "console.log('k2:' + require('crypto').randomBytes(32).toString('base64'))"

# 2. add it alongside the old one, and make it active
SECRET_ENCRYPTION_KEYS=k1:<old>,k2:<new>
SECRET_ENCRYPTION_ACTIVE_KEY_ID=k2
```

Existing ciphertexts carry their own key id, so they keep decrypting under `k1`
and are re-encrypted under `k2` the next time they are read. The
`maintenance.rotate_secrets` job sweeps anything nothing has read recently.

**Keep the old key until the sweep has run and you have verified no ciphertext
still names it.** Removing it early is the one way to lose credentials
permanently.

## Recovering from specific failures

**A bad migration.** Restore to the point immediately before it, replay the
application logs if you have them, redeploy the previous release. The schema is
additive, so an older build runs against a newer database — you usually have
more time than it feels like.

**A worker that got stuck.** Jobs claimed by a dead worker are returned to the
queue automatically after ten minutes. Jobs that exhausted their retries sit in
`state = 'dead'` and are listed, with their error, at Settings → Sync health,
where they can be retried individually.

**A sync that wrote something wrong.** Every field a sync changed is in
`sync_changes` and `audit_events` with its before and after value. That is
enough to reconstruct any single task by hand, and enough to answer "what
changed this, and when" without guessing.

**A user deleted something.** Tasks are hard-deleted only by explicit user
action; notes archive rather than delete. For a task, the audit trail records
what it was — but the row is gone, so a restore is the only full recovery. This
is a deliberate tradeoff against a "deleted items" area that would quietly
retain data users believe they removed.

## Deleting an account, properly

**Settings → Data & privacy → Delete permanently** removes stored objects first
(the database rows are the index of what exists, so deleting them first would
orphan the files), then deletes the user row, which cascades through every
table. Nothing is retained afterwards. Backups still contain it until they age
out, which the retention policy above should state plainly to users.

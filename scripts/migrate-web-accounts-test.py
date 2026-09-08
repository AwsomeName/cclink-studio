"""Isolated transfer checks; never touches actual Studio data."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('migration', Path(__file__).with_name('migrate-web-accounts.py'))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class MigrationTest(unittest.TestCase):
    def test_roundtrip_and_conflict(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            source, target, bundle = [base / name for name in ('source', 'target', 'bundle')]
            source.mkdir()
            target.mkdir()
            data = {'schemaVersion': 3, 'revision': 1, 'websites': [{'id': 'w'}],
                    'principals': [{'id': 'p'}], 'accountGroups': [],
                    'accounts': [{'id': 'a', 'websiteId': 'w', 'principalId': 'p',
                                  'browserProfileId': 'Profile-A', 'loginConfirmedAt': 'old'}]}
            migration.write_catalog(source, data)
            profile = source / migration.relative_profile('Profile-A')
            profile.mkdir(parents=True)
            (profile / 'Cookies').write_bytes(b'fixture-cookie-data')
            (profile / 'Cache').mkdir()
            (profile / 'Cache' / 'ignored').write_text('cache')
            (source / 'credentials.json').write_text('must-not-transfer')
            migration.export_data(source, bundle)
            self.assertFalse((bundle / 'credentials.json').exists())
            self.assertFalse((bundle / migration.relative_profile('Profile-A') / 'Cache').exists())
            migration.import_data(target, bundle)
            result = migration.read_catalog(target)
            self.assertNotIn('loginConfirmedAt', result['accounts'][0])
            self.assertEqual((target / migration.relative_profile('Profile-A') / 'Cookies').read_bytes(), b'fixture-cookie-data')
            before = (target / migration.CATALOG).read_bytes()
            with self.assertRaises(ValueError):
                migration.import_data(target, bundle)
            self.assertEqual(before, (target / migration.CATALOG).read_bytes())
            (bundle / 'evil').symlink_to(source)
            with self.assertRaises(ValueError):
                migration.import_data(target, bundle)

    def test_open_file_blocks_transfer(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with (root / 'open-file').open('w'):
                with self.assertRaises(ValueError):
                    migration.closed(root)


if __name__ == '__main__':
    unittest.main()

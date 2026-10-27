import io
import unittest
import zipfile
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

spec = spec_from_file_location('archive_check', Path(__file__).with_name('verify-archive.py'))
module = module_from_spec(spec)
spec.loader.exec_module(module)


class ArchiveChecks(unittest.TestCase):
    def bundle(self, changes=None, extra=None):
        files = {name: b'fixture' for name in module.REQUIRED}
        expected = {name: module.blob_sha(data) for name, data in files.items()}
        files.update(changes or {})
        files.update(extra or {})
        result = io.BytesIO()
        with zipfile.ZipFile(result, 'w') as archive:
            for name, data in files.items():
                archive.writestr('quota-mini-0.2.5/' + name, data)
        result.seek(0)
        return result, expected

    def test_valid_archive(self):
        archive, tree = self.bundle()
        self.assertEqual(module.verify_archive(archive, '0.2.5', tree), len(tree))

    def test_changed_source(self):
        archive, tree = self.bundle(changes={'plugins/quota-mini/server.mjs': b'changed'})
        with self.assertRaises(AssertionError):
            module.verify_archive(archive, '0.2.5', tree)

    def test_generated_launch_configuration(self):
        archive, tree = self.bundle(extra={'plugins/quota-mini/.mcp.json': b'local paths'})
        with self.assertRaises(AssertionError):
            module.verify_archive(archive, '0.2.5', tree)

    def test_unsafe_path(self):
        archive, tree = self.bundle(extra={'../outside': b'bad'})
        with self.assertRaises(AssertionError):
            module.verify_archive(archive, '0.2.5', tree)

    def test_missing_required_file(self):
        archive, tree = self.bundle()
        tree.pop('LICENSE')
        with self.assertRaises(AssertionError):
            module.verify_archive(archive, '0.2.5', tree)


if __name__ == '__main__':
    unittest.main()

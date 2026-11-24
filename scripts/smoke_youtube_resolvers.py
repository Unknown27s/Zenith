"""Offline resolver tests. Never contacts YouTube or launches a player."""
import json
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import youtube

URL = 'https://www.youtube.com/watch?v=dfVK7ld38Ys'
STREAM = 'https://example.googlevideo.com/live.m3u8?signature=private'


class ResolverTests(unittest.TestCase):
    def setUp(self):
        youtube._cache.clear()

    def test_primary_and_cache(self):
        metadata = {'is_live': True, 'url': STREAM}
        response = SimpleNamespace(returncode=0, stdout=json.dumps(metadata), stderr='')
        with patch.object(youtube.subprocess, 'run', return_value=response) as run:
            self.assertEqual(youtube.resolve(URL), STREAM)
            self.assertEqual(youtube.resolve(URL), STREAM)
            self.assertEqual(run.call_count, 1)
            command = run.call_args.args[0]
            self.assertIn('bestvideo[protocol^=m3u8][height<=720]',
                          command[command.index('-f') + 1])
            youtube.resolve(URL, use_cache=False)
            self.assertEqual(run.call_count, 2)

    def test_format_failure_uses_streamlink(self):
        responses = [
            SimpleNamespace(returncode=1, stdout='', stderr='Requested format is not available'),
            SimpleNamespace(returncode=0, stdout=STREAM + '\n', stderr=''),
        ]
        with patch.object(youtube.subprocess, 'run', side_effect=responses) as run:
            self.assertEqual(youtube.resolve(URL), STREAM)
            command = run.call_args.args[0]
            self.assertEqual(command[:3], [sys.executable, '-m', 'streamlink'])
            for option in ('--no-config', '--stream-url', '--no-plugin-sideloading'):
                self.assertIn(option, command)
            self.assertIn(URL, command)
            self.assertEqual(run.call_args.kwargs['timeout'], 30)
            self.assertNotIn('shell', run.call_args.kwargs)

    def test_timeout_uses_fallback(self):
        with patch.object(youtube.subprocess, 'run', side_effect=[
            subprocess.TimeoutExpired('yt_dlp', 45),
            SimpleNamespace(returncode=0, stdout=STREAM, stderr=''),
        ]):
            self.assertEqual(youtube.resolve(URL), STREAM)

    def test_restrictions_do_not_fallback(self):
        for code in ('restricted', 'bot_check', 'rate_limited', 'not_live',
                     'not_started', 'ended', 'unavailable', 'bad_stream'):
            with self.subTest(code=code), \
                    patch.object(youtube, '_resolve_ytdlp',
                                 side_effect=youtube.LiveResolveError(code, 'Primary reason')), \
                    patch.object(youtube, '_resolve_streamlink') as fallback:
                with self.assertRaises(youtube.LiveResolveError):
                    youtube.resolve(URL)
                fallback.assert_not_called()

    def test_fallback_rejects_unsafe_and_multiple_urls(self):
        for stream in ('http://127.0.0.1/private', 'https://youtube.com.evil.test/a',
                       'https://user:password@example.googlevideo.com/a',
                       STREAM + '\n' + STREAM, ''):
            with self.subTest(stream=stream), \
                    patch.object(youtube.subprocess, 'run',
                                 return_value=SimpleNamespace(returncode=0, stdout=stream, stderr='')):
                with self.assertRaises(youtube.LiveResolveError):
                    youtube._resolve_streamlink(URL)

    def test_failure_is_safe_and_preserves_primary_reason(self):
        for failure in (
            SimpleNamespace(returncode=1, stdout='', stderr='No module named streamlink'),
            SimpleNamespace(returncode=1, stdout='', stderr=STREAM),
            subprocess.TimeoutExpired('streamlink', 30),
        ):
            with self.subTest(failure=failure), \
                    patch.object(youtube, '_resolve_ytdlp',
                                 side_effect=youtube.LiveResolveError('no_format', 'No playable format')), \
                    patch.object(youtube.subprocess, 'run',
                                 side_effect=failure if isinstance(failure, Exception) else None,
                                 return_value=failure):
                with self.assertRaises(youtube.LiveResolveError) as caught:
                    youtube.resolve(URL)
                self.assertEqual(caught.exception.code, 'no_format')
                self.assertNotIn('signature=private', str(caught.exception))
                self.assertFalse(youtube._cache)

    def test_bad_input_never_launches_a_resolver(self):
        with patch.object(youtube.subprocess, 'run') as run:
            with self.assertRaises(youtube.LiveResolveError):
                youtube.resolve('rtsp://127.0.0.1/private')
            run.assert_not_called()

    def test_forget_cached_forces_fresh_resolve(self):
        response = SimpleNamespace(returncode=0, stdout=json.dumps(
            {'is_live': True, 'url': STREAM}), stderr='')
        with patch.object(youtube.subprocess, 'run', return_value=response) as run:
            youtube.resolve(URL)
            youtube.resolve(URL)
            self.assertEqual(run.call_count, 1)
            youtube.forget_cached(URL)
            youtube.resolve(URL)
            self.assertEqual(run.call_count, 2)
            youtube.forget_cached('rtsp://127.0.0.1/private')
            self.assertEqual(len(youtube._cache), 1)


class PreviewReconnectTests(unittest.TestCase):
    def test_dead_url_is_forgotten_and_retries_back_off(self):
        import os
        import tempfile
        os.environ.setdefault('ZENITH_API_KEY', 'offline-resolver-test-key-at-least-24-characters')
        os.environ.setdefault('ZENITH_DATA', tempfile.mkdtemp(prefix='zenith-resolver-'))
        import cv2
        from backend import live_preview

        waits = []

        class Stop:
            def is_set(self):
                return len(waits) >= 3

            def set(self):
                pass

            def wait(self, timeout):
                waits.append(timeout)

        class DeadCapture:
            def isOpened(self):
                return False

            def release(self):
                pass

        runtime = {'stop': Stop(), 'state': 'connecting'}
        with patch.object(live_preview.youtube, 'resolve', return_value=STREAM), \
                patch.object(cv2, 'VideoCapture', return_value=DeadCapture()), \
                patch.object(live_preview.youtube, 'forget_cached') as forget:
            live_preview._decode(runtime, URL)
        self.assertEqual(waits, [5, 10, 20])
        self.assertGreaterEqual(forget.call_count, 1)
        self.assertIn('reconnecting', runtime['state'])


if __name__ == '__main__':
    unittest.main()

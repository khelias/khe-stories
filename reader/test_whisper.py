import unittest

from whisper import CT2, MLX, pick


class Pick(unittest.TestCase):
    def test_apple_silicon_runs_mlx_whisper(self):
        self.assertIs(pick("Darwin", "arm64"), MLX)

    def test_linux_and_intel_macs_run_faster_whisper(self):
        self.assertIs(pick("Linux", "x86_64"), CT2)
        self.assertIs(pick("Darwin", "x86_64"), CT2)


if __name__ == "__main__":
    unittest.main()

# Optional local sample video

To validate actual browser video playback (not just codec support hints), put a short, trusted, unprotected H.264/AAC MP4 file here named test.mp4.

File is served by TVScope Bridge at /sample.mp4 and is **not committed to Git**. Prefer a short 720p or 1080p sample you have rights to use.

On JVC diagnostic page, press "Load local test video" and confirm picture, audio, stutter, seeking, and 10-minute stability manually.

If sample file is absent, server returns 404; this means "test unavailable", not "codec unsupported".

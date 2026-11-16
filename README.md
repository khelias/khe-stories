# khe-stories

Unejänku ("Sleepy Bunny"), the app the KHE family's bedtime stories are read
in: a library of stories, each read aloud in Estonian with its text beside the
audio, where listening resumes where it stopped and a story kept on the phone
plays offline.

This repo holds the code and a few invented demo stories. The family's own
stories are kept in a private repo, which builds this app at a pinned commit
with its own content and deploys it: to `stories.khe.ee` for the family, behind
a login, and to [khe.ee/stories](https://khe.ee/stories/) with the stories
chosen for publishing. Why it is split this way:
[estate ADR-031](https://github.com/khelias/khe-architecture/blob/main/decisions/031-stories-public-app-private-stories-audio-outside-git.md).

    npm ci
    npm run dev        # the public build over demo/ at http://localhost:5173/stories/
    npm run build      # both builds into output/public and output/family
    npm run preview    # serves output/public as the homelab does

How content plugs in is in [docs/content.md](docs/content.md); the app's
design decisions are in [docs/decisions/](docs/decisions/), and the commands and
conventions in [AGENTS.md](AGENTS.md).

The code is MIT-licensed ([LICENSE](LICENSE)). The demo audio in `demo/audio/`
is not: it is read by Pocket TTS Estonian in a voice cloned, with permission,
from the children's dad reading aloud, and all rights to it are reserved. The
real stories are read by TartuNLP XTTS v2 in his voice, which the app's credit
line names, with its licence.

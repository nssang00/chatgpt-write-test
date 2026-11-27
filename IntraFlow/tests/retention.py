import pathlib
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import closing

with tempfile.TemporaryDirectory() as tmp:
    count, age = (pathlib.Path(tmp)/x for x in ("count.db","age.db"))
    subprocess.run([sys.argv[1],str(count),str(age)]+sys.argv[2:],check=True,timeout=60)
    # The interval may also become due at publish 513 on a slow runner.
    for path, firsts, last in ((count,(497,498),513),(age,(9,),9)):
        with closing(sqlite3.connect(path)) as c:
            assert c.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
            seq=[r[0] for r in c.execute("SELECT seq FROM messages ORDER BY seq")]
            assert any(seq==list(range(first,last+1)) for first in firsts), (path,seq)
            assert c.execute("SELECT seq FROM sqlite_sequence WHERE name='messages'").fetchone()[0]==last
    print("PASS: exact retained suffix and SQLite integrity")

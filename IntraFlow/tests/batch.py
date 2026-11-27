import pathlib,sqlite3,subprocess,sys,tempfile
from contextlib import closing
with tempfile.TemporaryDirectory() as d:
    db=pathlib.Path(d)/"batch.db"
    subprocess.run([sys.argv[1],str(db)],check=True,timeout=40)
    with closing(sqlite3.connect(db)) as c:
        assert c.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
        assert c.execute("SELECT seq FROM messages ORDER BY seq").fetchall()==[(i,) for i in range(1,37)]
        assert dict(c.execute("SELECT topic,count(*) FROM messages GROUP BY topic"))=={"cmd":35,"status":1}

import pathlib,sqlite3,subprocess,sys,tempfile
from contextlib import closing
with tempfile.TemporaryDirectory() as d:
    db=pathlib.Path(d)/"filter.db"
    subprocess.run([sys.argv[1],str(db)],check=True,timeout=60)
    with closing(sqlite3.connect(db)) as c:
        assert c.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
        assert dict(c.execute("SELECT topic,count(*) FROM messages GROUP BY topic"))=={"a":1,"b":2,"ignored":900,"late":50}

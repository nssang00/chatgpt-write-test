"""Offline validation of Cito namespace netem profile construction."""
import importlib.util
from pathlib import Path
import sys, unittest

p=Path(__file__).resolve().parents[1]/'discovery_scale.py'
spec=importlib.util.spec_from_file_location('discovery_scale',p)
s=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=s
spec.loader.exec_module(s)

class TestNetem(unittest.TestCase):
    def test_baseline(self):
        self.assertEqual(s.netem_opts('baseline',200),[])
    def test_bandwidth(self):
        self.assertEqual(s.netem_opts('bandwidth_1m',200),['limit','200','rate','1000kbit'])
    def test_delay_split(self):
        x=s.netem_opts('congested',200)
        self.assertIn('25ms',x)
        self.assertIn('5ms',x)
    def test_loss_split(self):
        x=s.netem_opts('loss_1pct',200)
        prob=float(x[x.index('loss')+1][:-1])/100
        self.assertAlmostEqual(1-(1-prob)**2,0.01,places=7)
    def test_parser(self):
        self.assertEqual(s.publisher_stats('snapshot_requests=5 route_requests=3 discovered=3 sent=2')['sent'],2)
        self.assertIsNone(s.publisher_stats('publisher did not reach route state'))
    def test_all_profiles(self):
        for name in s.PROFILES:
            self.assertTrue(s.netem_opts(name,200) or name=='baseline')
    def test_addr(self):
        self.assertEqual(s.addr(699),'10.201.2.198')

if __name__=='__main__':
    unittest.main()

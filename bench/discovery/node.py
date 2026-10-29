#!/usr/bin/env python3
"""Per-netns presence convergence probe; not a general middleware implementation."""
import argparse
import json
import random
import resource
import select
import socket
import time
from pathlib import Path

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--backend', choices=['gossip', 'zenoh', 'cyclone'], required=True)
    p.add_argument('--id', type=int, required=True)
    p.add_argument('--count', type=int, required=True)
    p.add_argument('--workdir', required=True)
    args = p.parse_args()
    wd = Path(args.workdir)
    own = args.id
    known = {own: f'10.77.{own // 250}.{own % 250 + 1}'}
    if args.backend == 'zenoh':
        import zenoh
    elif args.backend == 'cyclone':
        from dataclasses import dataclass
        from cyclonedds.domain import DomainParticipant
        from cyclonedds.topic import Topic
        from cyclonedds.pub import DataWriter
        from cyclonedds.sub import DataReader
        from cyclonedds.idl import IdlStruct
        from cyclonedds.idl.annotations import keylist
        @dataclass
        @keylist(['node_id'])
        class Alive(IdlStruct):
            node_id: int
            sequence: int

    (wd / f'ready-{own}').touch()
    while not (wd / 'go').exists():
        time.sleep(.015)
    begin = time.monotonic()
    completed = None
    sent = 0
    recv = 0
    sequence = 0
    random.seed(own * 31 + 7)
    if args.backend == 'gossip':
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(('', 7701))
        own_ip = known[own]
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP,
                        socket.inet_aton('239.77.77.77') + socket.inet_aton(own_ip))
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(own_ip))
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1)
        sock.setblocking(False)
        next_hello = begin + random.random() * .45
        last_state = 0
    elif args.backend == 'zenoh':
        session = zenoh.open(zenoh.Config())
        def on_sample(sample):
            nonlocal recv
            try:
                i = int(sample.payload.to_string())
                if 0 <= i < args.count:
                    known[i] = ''
                    recv += 1
            except Exception:
                pass
        sub = session.declare_subscriber('bench/alive/*', on_sample)
        next_send = begin + .35 + random.random() * .2
    else:
        participant = DomainParticipant(domain_id=55)
        topic = Topic(participant, 'bench_alive', Alive)
        writer = DataWriter(participant, topic)
        reader = DataReader(participant, topic)
        next_send = begin + .35 + random.random() * .2

    def send(packet, addr):
        nonlocal sent
        sock.sendto(json.dumps(packet, separators=(',', ':')).encode(), addr)
        sent += 1

    while not (wd / 'stop').exists():
        now = time.monotonic()
        if args.backend == 'gossip':
            if now >= next_hello:
                send({'t': 'h', 'i': own, 'a': own_ip}, ('239.77.77.77', 7701))
                next_hello = now + 3 + random.random() * .4
            if now - last_state >= .55:
                peers = [i for i in known if i != own]
                for i in random.sample(peers, min(4, len(peers))):
                    send({'t': 's', 'i': own, 'ids': list(known)}, (known[i], 7701))
                last_state = now
            for _ in range(60):
                if not select.select([sock], [], [], 0)[0]:
                    break
                try:
                    data, addr = sock.recvfrom(65535)
                    msg = json.loads(data)
                    recv += 1
                    sender = int(msg['i'])
                    if 0 <= sender < args.count:
                        known[sender] = addr[0]
                    if msg['t'] == 's':
                        others = {int(i) for i in msg['ids'] if 0 <= int(i) < args.count}
                        missing = list(others - known.keys())[:100]
                        if missing:
                            send({'t': 'q', 'i': own, 'ids': missing}, addr)
                        extras = [i for i in known if i not in others]
                        if extras:
                            send({'t': 'd', 'i': own, 'items': [[i, known[i]] for i in extras[:100]]}, addr)
                    elif msg['t'] == 'q':
                        items = [[i, known[i]] for i in msg['ids'] if i in known]
                        if items:
                            send({'t': 'd', 'i': own, 'items': items}, addr)
                    elif msg['t'] == 'd':
                        for i, ip in msg['items']:
                            if 0 <= i < args.count and ip:
                                known[i] = ip
                except (OSError, ValueError, KeyError, TypeError):
                    continue
        elif args.backend == 'zenoh':
            if now >= next_send:
                session.put(f'bench/alive/{own}', str(own))
                sent += 1
                next_send = now + .7
        else:
            if now >= next_send:
                writer.write(Alive(node_id=own, sequence=sequence))
                sequence += 1
                sent += 1
                next_send = now + .7
            for msg in reader.take(N=256):
                i = msg.node_id
                if 0 <= i < args.count:
                    known[i] = ''
                    recv += 1
        if completed is None and len(known) == args.count:
            completed = time.monotonic() - begin
            (wd / f'done-{own}').touch()
        time.sleep(.012)
    (wd / f'node-{own}.json').write_text(json.dumps({
        'node_id': own, 'backend': args.backend, 'known': len(known),
        'complete_s': completed, 'elapsed_s': time.monotonic() - begin,
        'sent': sent, 'received': recv, 'cpu_s': time.process_time(),
        'maxrss_kb': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    }))
    if args.backend == 'gossip':
        sock.close()
    elif args.backend == 'zenoh':
        sub.undeclare()
        session.close()

if __name__ == '__main__':
    main()

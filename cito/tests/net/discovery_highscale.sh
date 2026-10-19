#!/usr/bin/env bash
# Real Cito HostRuntimeCore/UdpRuntimeAdapter scaling benchmark on Ubuntu CI.
# One publisher and N independent matching subscribers, with one Linux netns,
# unique IPv4 address, and separate OS process for every logical node.
set -euo pipefail
BIN="${1:?path to cito_runtime_udp_node}"
RESULTS="${GITHUB_WORKSPACE:-$PWD}/discovery-highscale-results.tsv"
printf 'subscribers\ttotal_nodes\tdiscovered\tsent\treceived\tfailures\tpublisher_exit\telapsed_ms\tresult\n' > "$RESULTS"

declare -a PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  for ns in $(sudo ip netns list | awk '{print $1}' | grep -E '^ch-[0-9]+$|^ch-pub$' || true); do
    sudo ip netns del "$ns" 2>/dev/null || true
  done
  sudo ip link del chbridge 2>/dev/null || true
  PIDS=()
}
trap cleanup EXIT

add_node() {
  local ns="$1" host="$2" peer="$3" addr="$4"
  sudo ip netns add "$ns"
  sudo ip link add "$host" type veth peer name "$peer"
  sudo ip link set "$host" master chbridge
  sudo ip link set "$host" up
  sudo ip link set "$peer" netns "$ns"
  sudo ip netns exec "$ns" ip link set lo up
  sudo ip netns exec "$ns" ip link set "$peer" name eth0
  sudo ip netns exec "$ns" ip addr add "$addr"/16 dev eth0
  sudo ip netns exec "$ns" ip link set eth0 up
}

any_failed=0
for n in 500 511 512; do
  cleanup
  mkdir -p "highscale-logs/n$n"
  echo "=== HIGHSCALE_START subscribers=$n total_nodes=$((n+1)) ==="
  sudo ip link add chbridge type bridge
  sudo ip link set chbridge up
  add_node ch-pub chvpub chnpub 10.222.0.10
  for ((i=1;i<=n;i++)); do
    third=$(((i-1)/200))
    fourth=$((30+(i-1)%200))
    add_node "ch-$i" "chv$i" "chn$i" "10.222.$third.$fourth"
  done
  start_ms=$(date +%s%3N)
  sudo ip netns exec ch-pub timeout 32s "$BIN" \
    publisher 100 47100 "$n" 30000 >"highscale-logs/n$n/publisher.log" 2>&1 &
  PUB_PID=$!
  PIDS+=("$PUB_PID")
  sleep 0.4
  subs=()
  for ((i=1;i<=n;i++)); do
    sudo ip netns exec "ch-$i" timeout 29s "$BIN" \
      subscriber "$((1000+i))" 100 "$((49000+i))" \
      "$((48000+i))" 47100 10.222.255.255 1 26000 5000 \
      >"highscale-logs/n$n/sub-$i.log" 2>&1 &
    subs+=("$!")
    PIDS+=("$!")
    # Avoid a 512-process simultaneous advertisement/ARP burst. Each
    # subscriber still has its own OS process and network namespace.
    if ((i % 8 == 0)); then sleep 0.05; fi
  done
  pub_exit=0
  wait "$PUB_PID" || pub_exit=$?
  received=0
  failures=0
  failed_printed=0
  for ((i=1;i<=n;i++)); do
    rc=0
    wait "${subs[i-1]}" || rc=$?
    if [[ "$rc" == 0 ]] && grep -q '^received=1' "highscale-logs/n$n/sub-$i.log"; then
      received=$((received+1))
    else
      failures=$((failures+1))
      if ((failed_printed<8)); then
        echo "NODE_FAIL n=$n node=$i rc=$rc"
        tail -n 3 "highscale-logs/n$n/sub-$i.log" || true
        failed_printed=$((failed_printed+1))
      fi
    fi
  done
  elapsed_ms=$(( $(date +%s%3N) - start_ms ))
  echo "=== publisher output for $n matching subscribers ==="
  cat "highscale-logs/n$n/publisher.log"
  discovered=$(sed -nE 's/.*discovered=([0-9]+).*/\1/p' "highscale-logs/n$n/publisher.log" | tail -1)
  sent=$(sed -nE 's/.*sent=([0-9]+).*/\1/p' "highscale-logs/n$n/publisher.log" | tail -1)
  discovered=${discovered:-0}
  sent=${sent:-0}
  result=FAIL
  if ((pub_exit==0 && discovered==n && sent==n && received==n && failures==0)); then
    result=PASS
  else
    any_failed=1
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$n" "$((n+1))" "$discovered" "$sent" "$received" "$failures" \
    "$pub_exit" "$elapsed_ms" "$result" >> "$RESULTS"
  echo "HIGHSCALE_RESULT subscribers=$n total_nodes=$((n+1)) discovered=$discovered sent=$sent received=$received failures=$failures elapsed_ms=$elapsed_ms result=$result"
  free -m | sed -n '1,2p'
done

echo '=== Final highscale results ==='
cat "$RESULTS"
if ((any_failed!=0)); then
  echo 'One or more highscale cases failed; preserved per-process logs.'
  exit 1
fi

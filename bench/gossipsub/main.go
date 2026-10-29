package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	libp2p "github.com/libp2p/go-libp2p"
	pubsub "github.com/libp2p/go-libp2p-pubsub"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/network"
	ma "github.com/multiformats/go-multiaddr"
)

type payload struct {
	Origin int    `json:"i"`
	Seq    int    `json:"s"`
	Value  string `json:"v"`
}
type info struct {
	Addr string `json:"addr"`
}
type result struct {
	Node            int     `json:"node"`
	N               int     `json:"n"`
	Messages        int     `json:"messages"`
	Received        int     `json:"received"`
	Expected        int     `json:"expected"`
	RemoteReceived  int     `json:"remote_received"`
	RemoteExpected  int     `json:"remote_expected"`
	FullS           float64 `json:"full_s"`
	ReadyS          float64 `json:"ready_s"`
	PubPeerCount    int     `json:"topic_peers"`
	HostPeerCount   int     `json:"host_peers"`
	ConnectOK       int     `json:"connect_ok"`
	ConnectErrors   int     `json:"connect_errors"`
	Sent            int     `json:"sent"`
	PublishErrors   int     `json:"publish_errors"`
	Duplicates      int     `json:"duplicates"`
	Errors          []string `json:"errors"`
}
func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
func touch(path string) {
	if err:=os.WriteFile(path, []byte{}, 0644); err!=nil { fail(err) }
}
func waitFile(path string) {
	for {
		if _,err:=os.Stat(path);err==nil{return}
		time.Sleep(15*time.Millisecond)
	}
}
func remoteIP(i int) string {
	return fmt.Sprintf("10.77.%d.%d",i/250,i%250+1)
}
func main() {
	id:=flag.Int("id",0,"node index")
	n:=flag.Int("n",10,"node count")
	m:=flag.Int("messages",2,"messages per node")
	seed:=flag.Int("seed",1,"deterministic publication seed")
	warmup:=flag.Float64("warmup",15,"time before publishing")
	spread:=flag.Float64("spread",4,"publication jitter span")
	duration:=flag.Float64("duration",40,"test duration including warmup")
	dir:=flag.String("workdir","","shared control folder")
	flag.Parse()
	if *n<2 || *dir=="" {fail(fmt.Errorf("invalid node count/workdir"))}
	ctx,cancel:=context.WithTimeout(context.Background(),time.Duration(*duration+30)*time.Second)
	defer cancel()
	host,err:=libp2p.New(libp2p.ListenAddrStrings("/ip4/0.0.0.0/tcp/7711"),libp2p.DisableRelay())
	if err!=nil {fail(fmt.Errorf("libp2p.New: %w",err))}
	defer host.Close()
	ps,err:=pubsub.NewGossipSub(ctx,host,pubsub.WithFloodPublish(true))
	if err!=nil {fail(fmt.Errorf("NewGossipSub: %w",err))}
	topic,err:=ps.Join("bench/all")
	if err!=nil {fail(fmt.Errorf("Join: %w",err))}
	defer topic.Close()
	sub,err:=topic.Subscribe()
	if err!=nil {fail(fmt.Errorf("Subscribe: %w",err))}
	defer sub.Cancel()
	blob,_:=json.Marshal(info{Addr:fmt.Sprintf("/ip4/%s/tcp/7711/p2p/%s",remoteIP(*id),host.ID())})
	if err:=os.WriteFile(filepath.Join(*dir,fmt.Sprintf("info-%d.json",*id)),blob,0644);err!=nil{fail(err)}
	touch(filepath.Join(*dir,fmt.Sprintf("ready-%d",*id)))
	waitFile(filepath.Join(*dir,"go"))
	start:=time.Now()
	var mu sync.Mutex
	received:=map[[2]int]struct{}{}
	duplicate:=0
	badSamples:=0
	fullAt:=0.0
	readyAt:=0.0
	connectOK,connectErr:=0,0
	sent,publishErr:=0,0
	errs:=[]string{}
	go func(){
		for {
			msg,err:=sub.Next(ctx)
			if err!=nil{return}
			var p payload
			if json.Unmarshal(msg.Data,&p)!=nil || p.Origin<0 || p.Origin>=*n || p.Seq<0 || p.Seq>=*m || len(p.Value)!=32 {
				mu.Lock();badSamples++;mu.Unlock();continue
			}
			mu.Lock()
			k:=[2]int{p.Origin,p.Seq}
			if _,ok:=received[k];ok{duplicate++} else {received[k]=struct{}{}}
			mu.Unlock()
		}
	}()
	neigh:=map[int]struct{}{}
	for _,off:=range []int{-1,1,-2,2,-7,7} {
		x:=(*id+off+*n*2)%*n
		if x!=*id {neigh[x]=struct{}{}}
	}
	var neighbors []int
	for x:=range neigh {neighbors=append(neighbors,x)}
	sort.Ints(neighbors)
	var wg sync.WaitGroup
	for _,j:=range neighbors {
		// Each undirected edge has exactly one dialer. Simultaneous
		// bidirectional TCP dials produced libp2p TLS ClientHello races.
		if j<*id {continue}
		wg.Add(1)
		go func(j int){
			defer wg.Done()
			raw,err:=os.ReadFile(filepath.Join(*dir,fmt.Sprintf("info-%d.json",j)))
			if err!=nil {mu.Lock();connectErr++;mu.Unlock();return}
			var inf info
			if json.Unmarshal(raw,&inf)!=nil {mu.Lock();connectErr++;mu.Unlock();return}
			addr,err:=ma.NewMultiaddr(inf.Addr)
			if err!=nil {mu.Lock();connectErr++;mu.Unlock();return}
			pi,err:=peer.AddrInfoFromP2pAddr(addr)
			if err!=nil {mu.Lock();connectErr++;mu.Unlock();return}
			// One directional dialer per link also owns link maintenance.
			// Gossipsub itself does not connect/rediscover peers: the application
			// must re-bootstrap disconnected mesh links.
			deadline:=start.Add(time.Duration(*duration*float64(time.Second)))
			everConnected:=false
			attempt:=0
			firstError:=""
			for time.Now().Before(deadline) && ctx.Err()==nil {
				if host.Network().Connectedness(pi.ID)==network.Connected {
					everConnected=true
					attempt=0
					time.Sleep(650*time.Millisecond)
					continue
				}
				cctx,cancel:=context.WithTimeout(ctx,1600*time.Millisecond)
				err=host.Connect(cctx,*pi)
				cancel()
				if err==nil {
					mu.Lock();connectOK++;mu.Unlock()
					everConnected=true
					attempt=0
					time.Sleep(650*time.Millisecond)
					continue
				}
				if firstError=="" {firstError=err.Error()}
				sleepMs:=400+attempt*150
				if sleepMs>1800 {sleepMs=1800}
				attempt++
				time.Sleep(time.Duration(sleepMs)*time.Millisecond)
			}
			if !everConnected {
				mu.Lock();connectErr++;errs=append(errs,fmt.Sprintf("connect %d initial=%s final=%v",j,firstError,err));mu.Unlock()
			}
		}(j)
	}
	go wg.Wait()
	pubAt:=*warmup+float64((*seed*31+*id*53)%1009)/1009.0*(*spread)
	nextPub:=pubAt
	holdComplete:=false
	ticker:=time.NewTicker(18*time.Millisecond)
	defer ticker.Stop()
	for {
		<-ticker.C
		elapsed:=time.Since(start).Seconds()
		if readyAt==0 && len(topic.ListPeers())>=2 {readyAt=elapsed}
		if elapsed>=nextPub && sent<*m {
			msg:=payload{Origin:*id,Seq:sent,Value:"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
			data,_:=json.Marshal(msg)
			pctx,cancel:=context.WithTimeout(ctx,2*time.Second)
			err:=topic.Publish(pctx,data)
			cancel()
			mu.Lock()
			if err==nil {
				received[[2]int{*id,sent}]=struct{}{}
			}else {
				publishErr++
				errs=append(errs,"Publish: "+err.Error())
			}
			sent++
			mu.Unlock()
			nextPub+=0.28
		}
		mu.Lock()
		complete:=len(received)==*n*(*m)
		mu.Unlock()
		if complete && !holdComplete {
			fullAt=elapsed
			touch(filepath.Join(*dir,fmt.Sprintf("done-%d",*id)))
			holdComplete=true
		}
		if elapsed>=*duration {
			break
		}
		if _,err:=os.Stat(filepath.Join(*dir,"stop"));err==nil{break}
	}
	mu.Lock()
	got:=len(received)
	out:=result{Node:*id,N:*n,Messages:*m,Received:got,Expected:*n*(*m),
		RemoteReceived:got-sent,RemoteExpected:(*n-1)*(*m),
		FullS:fullAt,ReadyS:readyAt,PubPeerCount:len(topic.ListPeers()),
		HostPeerCount:len(host.Network().Peers()),ConnectOK:connectOK,
		ConnectErrors:connectErr,Sent:sent,PublishErrors:publishErr,
		Duplicates:duplicate,Errors:errs}
	if badSamples>0{out.Errors=append(out.Errors,fmt.Sprintf("bad=%d",badSamples))}
	mu.Unlock()
	b,_:=json.MarshalIndent(out,"","  ")
	if err:=os.WriteFile(filepath.Join(*dir,fmt.Sprintf("node-%d.json",*id)),b,0644);err!=nil{fail(err)}
}

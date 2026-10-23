from pathlib import Path
import sys
p=Path(sys.argv[1])/'src/framework/UnifiedStudio.jsx'
s=p.read_text(encoding='utf-8')
old='value={eventField} options={Object.keys(meta.events).map(k=>({label:k,value:k}))} onChange={setEventField}/><Button size="small" block onClick={()=>onExposeEvent(eventField,eventName)}>Expose Event</Button>'
new='value={meta.events[eventField]?eventField:Object.keys(meta.events)[0]} options={Object.keys(meta.events).map(k=>({label:k,value:k}))} onChange={setEventField}/><Button size="small" block onClick={()=>onExposeEvent(meta.events[eventField]?eventField:Object.keys(meta.events)[0],eventName)}>Expose Event</Button>'
assert s.count(old)==1,f'marker must be unique, got {s.count(old)}'
p.write_text(s.replace(old,new),encoding='utf-8')
print('Nested public events now default to first valid event, not hard-coded click')

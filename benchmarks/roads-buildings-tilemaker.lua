-- Deliberately narrow, reproducible OSM-only comparison.
-- Exact geometry parity is not guaranteed because engines clip/encode differently.
node_keys = {}
way_keys = { "highway", "building" }

function node_function()
end

function way_function()
    local highway = Find("highway")
    local building = Find("building")
    -- Roads as lines; exclude explicitly area-tagged highway objects.
    if highway ~= "" and Find("area") ~= "yes" then
        Layer("roads", false)
        Attribute("highway", highway)
    end
    -- Building polygons only. tilemaker processes multipolygons via way_function.
    if building ~= "" and building ~= "no" and IsClosed() then
        Layer("buildings", true)
        Attribute("building", building)
    end
end

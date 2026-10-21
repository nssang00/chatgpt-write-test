package com.kitefiles.android;

import com.kitefiles.core.FileEngine;
import com.kitefiles.core.FileNode;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Needs local Samba server. No real user credentials. Run only when KITE_SMB_CI=1. */
public class SmbFileStoreIntegrationTest {
    @Test public void realSambaShareLifecycleAndCopy() throws Exception {
        if (!"1".equals(System.getenv("KITE_SMB_CI"))) return;
        SmbFileStore smb=new SmbFileStore("127.0.0.1","share","","kfsci","KiteCI!2026");
        String root=smb.root();
        assertNotNull(smb.list(root));
        FileEngine engine=new FileEngine(smb);
        FileNode folder=engine.newFolder(root,"kite-ci-fixtures");
        try {
            FileNode original=engine.newFile(folder.id,"integration.txt");
            byte[] expected="KiteFiles real SMB2 integration 테스트".getBytes(StandardCharsets.UTF_8);
            try(OutputStream stream=smb.write(original.id)){stream.write(expected);}
            assertArrayEquals(expected,readAll(smb.read(original.id)));
            FileNode renamed=engine.rename(original.id,"renamed.txt",folder.id);
            assertEquals("renamed.txt",renamed.name);
            assertEquals(1,smb.list(folder.id).size());
            engine.transfer(Collections.singletonList(renamed.id),root,false,FileEngine.QUIET);
            FileNode copied=null;
            for(FileNode x:smb.list(root)) if(x.name.equals("renamed.txt")) copied=x;
            assertNotNull(copied);
            assertArrayEquals(expected,readAll(smb.read(copied.id)));
            smb.delete(copied.id);
        } finally {
            smb.delete(folder.id);
        }
        System.out.println("SMB INTEGRATION RESULT: authenticated list/create/read/rename/copy/delete PASS");
    }
    private static byte[] readAll(InputStream stream) throws Exception {
        try(InputStream in=stream;ByteArrayOutputStream output=new ByteArrayOutputStream()){
            byte[] b=new byte[8192];int n;
            while((n=in.read(b))!=-1)output.write(b,0,n);
            return output.toByteArray();
        }
    }
}

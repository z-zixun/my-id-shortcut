import { bitable, IOpenAttachment } from "@lark-opdev/block-bitable-api";
import { FC, useEffect, useState } from "react";
import { Typography, Button, Toast } from "@douyinfe/semi-ui";

const { Title, Text } = Typography;

// 从环境变量读取配置（打包时会被替换为实际值）
const ARK_API_KEY = process.env.ARK_API_KEY || "";
const ARK_ENDPOINT_ID = process.env.ARK_ENDPOINT_ID || "";

export const App: FC = () => {
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [currentName, setCurrentName] = useState("未选中行");

  // 等待 SDK 初始化
  useEffect(() => {
    let off: (() => void) | null = null;

    const init = async () => {
      try {
        // 等待 bitable bridge 准备好
        await bitable.base.getSelection();
        setReady(true);

        const updateName = async () => {
          try {
            const selection = await bitable.base.getSelection();
            if (selection.tableId && selection.recordId) {
              const table = await bitable.base.getTableById(selection.tableId);
              const nameField = await table.getFieldByName("姓名");
              const nameValue = await table.getCellValue(nameField.id, selection.recordId);
              if (Array.isArray(nameValue) && nameValue.length > 0) {
                const text = nameValue.map((seg: any) => seg.text).join("");
                setCurrentName(text || "无姓名");
              } else {
                setCurrentName("无姓名");
              }
            } else {
              setCurrentName("未选中行");
            }
          } catch (e) {
            console.error("获取姓名失败:", e);
          }
        };

        updateName();
        off = bitable.base.onSelectionChange(() => updateName());
      } catch (e) {
        console.error("SDK 初始化失败:", e);
        setReady(true); // 即使失败也显示界面
      }
    };

    init();
    return () => { if (off) off(); };
  }, []);

  if (!ready) {
    return <div style={{ padding: 20, textAlign: "center" }}>正在连接飞书...</div>;
  }

  const runAI = async () => {
    setLoading(true);
    try {
      const selection = await bitable.base.getSelection();
      const { tableId, recordId } = selection;
      if (!tableId || !recordId) throw new Error("请先选中一行");

      const table = await bitable.base.getTableById(tableId);

      // 获取姓名
      const nameField = await table.getFieldByName("姓名");
      const nameValue = await table.getCellValue(nameField.id, recordId);
      let name = "";
      if (Array.isArray(nameValue) && nameValue.length > 0) {
        name = nameValue.map((seg: any) => seg.text).join("");
      }
      if (!name) throw new Error("该行姓名为空");

      // 获取附件
      const attachmentField = await table.getFieldByName("工商档案");
      const attachments = await table.getCellValue(attachmentField.id, recordId) as IOpenAttachment[] | null;

      if (!attachments || attachments.length === 0) throw new Error("该行没有工商档案附件");

      Toast.info("正在获取文件并呼叫豆包 AI...");

      // 获取附件临时链接
      const attachment = attachments[0];
      const fileUrl = await table.getAttachmentUrl(attachment.token, attachmentField.id, recordId);

      if (!fileUrl) throw new Error("获取附件链接失败");

      // 调用豆包 API
      const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${ARK_API_KEY}`
        },
        body: JSON.stringify({
          model: ARK_ENDPOINT_ID,
          messages: [
            { role: "system", content: "你是一个证件提取专家，只需返回18位身份证号，不匹配则返回'未匹配'。" },
            {
              role: "user",
              content: [
                { type: "text", text: `请从文档中提取姓名是"${name}"的人的18位身份证号。不要解释说明。` },
                { type: "image_url", image_url: { url: fileUrl } }
              ]
            }
          ]
        })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error.message);

      const res = data.choices[0].message.content.trim();

      // 写回表格 - 文本字段需要写入 IOpenSegment[] 格式
      const idField = await table.getFieldByName("身份证号");
      await table.setCellValue(idField.id, recordId, [{ type: "text", text: res }]);

      Toast.success(res === "未匹配" ? "AI 未发现匹配信息" : "提取并填入成功！");
    } catch (e: any) {
      Toast.error("报错提示：" + e.message);
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <Title heading={4} style={{ marginBottom: 12 }}>🆔 ID 智能提取</Title>
      <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 8, marginBottom: 16 }}>
        <Text style={{ fontSize: 14 }}>当前选中人员：</Text>
        <Text strong style={{ fontSize: 18, color: '#1677ff', display: 'block' }}>{currentName}</Text>
      </div>
      <Button 
        loading={loading} 
        type="primary" 
        theme="solid" 
        onClick={runAI} 
        block 
        size="large"
      >
        开始 AI 匹配识别
      </Button>
      <Text type="secondary" style={{ marginTop: 12, display: 'block', fontSize: 12 }}>
        注意：请确保“工商档案”列已有 PDF 或图片
      </Text>
    </div>
  );
};
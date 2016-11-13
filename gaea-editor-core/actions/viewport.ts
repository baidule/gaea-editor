import {injectable} from 'inversify'
import {action, observable, extendObservable, transaction} from 'mobx'
import ViewportStore from '../stores/viewport'
import ApplicationAction from '../actions/application'
import EventAction from '../actions/event'
import EventStore from '../stores/event'
import {lazyInject} from '../utils/kernel'
import * as Sortable from 'sortablejs'
import * as _ from 'lodash'
import {error} from "util";

@injectable()
export default class ViewportAction {
    @lazyInject(ViewportStore) private viewport: ViewportStore
    @lazyInject(ApplicationAction) private applicationAction: ApplicationAction
    @lazyInject(EventAction) private eventAction: EventAction
    @lazyInject(EventStore) private event: EventStore

    @action('设置根节点唯一标识') setRootMapUniqueKey(mapUniqueKey: string) {
        this.viewport.rootMapUniqueKey = mapUniqueKey
    }

    @action('在视图中设置组件信息') setComponent(mapUniqueKey: string, componentInfo: FitGaea.ViewportComponentInfo) {
        let componentInfoClone = _.cloneDeep(componentInfo)

        componentInfoClone.props = this.completionEditProps(componentInfo.props)

        if (componentInfoClone.parentMapUniqueKey === null) {
            // 最外层必须相对定位，不能修改
            componentInfoClone.props.gaeaEdit = componentInfoClone.props.gaeaEdit.filter((edit: any)=>edit.editor !== 'position' && edit !== '定位')
        }

        componentInfoClone.props = extendObservable({}, componentInfoClone.props)

        this.viewport.components.set(mapUniqueKey, componentInfoClone)
    }

    @action('新增全新的组件') addNewComponent(uniqueKey: string, parentMapUniqueKey: string, index: number) {
        const mapUniqueKey = this.createUniqueKey()

        // 找到操作组件的 class
        const ComponentClass = this.applicationAction.getComponentClassByGaeaUniqueKey(uniqueKey)

        // 从 startDragging 设置的 uniqueKey 生成新组件并且绑定上
        const newProps = _.cloneDeep(ComponentClass.defaultProps)

        let component: FitGaea.ViewportComponentInfo = {
            props: newProps,
            parentMapUniqueKey: parentMapUniqueKey
        }

        if (ComponentClass.defaultProps.canDragIn) {
            // 如果是个布局元素, 将其 layoutChilds 设置为数组
            component.layoutChilds = []
        }

        this.setComponent(mapUniqueKey, component)

        // 在父级中插入子元素
        this.viewport.components.get(parentMapUniqueKey).layoutChilds.splice(index, 0, mapUniqueKey)

        return mapUniqueKey
    }

    @action('移动组件') moveComponent(sourceMapUniqueKey: string, sourceIndex: number, targetMapUniqueKey: string, targetIndex: number) {
        const sourceComponentInfo = this.viewport.components.get(sourceMapUniqueKey)
        const targetComponentInfo = this.viewport.components.get(targetMapUniqueKey)

        // 移动元素的 mapUniqueKey
        const moveComponentMapUniqueKey = sourceComponentInfo.layoutChilds[sourceIndex]

        // 找到移动元素的信息
        const moveComponentInfo = this.viewport.components.get(moveComponentMapUniqueKey)

        // 修改拖拽元素的 parentMapUniqueKey
        moveComponentInfo.parentMapUniqueKey = targetMapUniqueKey
        // 在拖拽目标 layoutChilds 中插入子元素
        targetComponentInfo.layoutChilds.splice(targetIndex, 0, moveComponentMapUniqueKey)

        // 拖拽源删除元素
        sourceComponentInfo.layoutChilds.splice(sourceIndex, 1)
    }

    @action('组件在同父级移动位置') horizontalMoveComponent(parentMapUniqueKey: string, beforeIndex: number, afterIndex: number) {
        const layoutChilds = this.viewport.components.get(parentMapUniqueKey).layoutChilds
        if (beforeIndex < afterIndex) {
            // 从左到右
            transaction(()=> {
                for (let index = beforeIndex; index < afterIndex; index++) {
                    const beforeUniqueKey = layoutChilds[index]
                    const afterUniqueKey = layoutChilds[index + 1]
                    layoutChilds[index] = afterUniqueKey
                    layoutChilds[index + 1] = beforeUniqueKey
                }
            })
        } else {
            // 从右到左
            transaction(()=> {
                for (let index = beforeIndex; index > afterIndex; index--) {
                    const beforeUniqueKey = layoutChilds[index]
                    const afterUniqueKey = layoutChilds[index - 1]
                    layoutChilds[index] = afterUniqueKey
                    layoutChilds[index - 1] = beforeUniqueKey
                }
            })
        }
    }

    @action('新增模板组件') addComboComponent() {
    }

    @action('移除组件') removeComponent(mapUniqueKey: string) {
        const removeComponentInfo = this.viewport.components.get(mapUniqueKey)

        // 根节点无法删除
        if (removeComponentInfo.parentMapUniqueKey === null) {
            throw '不能删除根节点'
        }

        transaction(()=> {
            // 删除这个组件的子组件
            const childMapUniqueKeys = this.getAllChildsByMapUniqueKey(mapUniqueKey)
            childMapUniqueKeys.forEach(childMapUniqueKey=> {
                this.viewport.components.delete(childMapUniqueKey)
            })

            // 找到被删除组件的父组件
            const parentComponentInfo = this.viewport.components.get(removeComponentInfo.parentMapUniqueKey)
            // 从父组件的孩子节点列表中移除
            parentComponentInfo.layoutChilds = parentComponentInfo.layoutChilds.filter(childMapUniqueKey=>childMapUniqueKey !== mapUniqueKey)

            // 从 store 中删除
            this.viewport.components.delete(mapUniqueKey)

            // 如果要删除的组件就是正在编辑的组件，退出编辑状态
            if (mapUniqueKey === this.viewport.currentEditComponentMapUniqueKey) {
                this.setCurrentEditComponentMapUniqueKey(null)
            }
        })
    }

    @action('设置视图区域 dom 节点') setViewportDom(dom: HTMLElement) {
        this.viewport.viewportDom = dom
    }

    @action('设置当前 hover 元素的 mapUniqueKey') setCurrentHoverComponentMapUniqueKey(mapUniqueKey: string) {
        this.viewport.currentHoverComponentMapUniqueKey = mapUniqueKey
    }

    @action('设置当前 edit 元素的 mapUniqueKey') setCurrentEditComponentMapUniqueKey(mapUniqueKey: string) {
        this.viewport.currentEditComponentMapUniqueKey = mapUniqueKey

        setTimeout(()=> {
            this.viewport.showEditComponents = !!mapUniqueKey
        }, 150)
    }

    @action('生成唯一 key') createUniqueKey() {
        return _.uniqueId('gaea-component-' + new Date().getTime() + '-')
    }

    @action('设置视图 dom 实例') setDomInstance(mapUniqueKey: string, dom: HTMLElement) {
        this.viewport.componentDomInstances.set(mapUniqueKey, dom)
    }

    @action('移除一个视图 dom 实例') removeDomInstance(mapUniqueKey: string) {
        this.viewport.componentDomInstances.delete(mapUniqueKey)
    }

    @action('开始拖拽') startDrag(dragInfo: FitGaea.CurrentDragComponentInfo) {
        this.viewport.currentDragComponentInfo = dragInfo
    }

    @action('结束拖拽') endDrag() {
        this.viewport.currentDragComponentInfo = null
    }

    @action('从视图中移动到新父级时，设置拖拽目标（父级）的信息') setDragTargetInfo(mapUniqueKey: string, index: number) {
        this.viewport.currentDragComponentInfo.viewportInfo.targetMapUniqueKey = mapUniqueKey
        this.viewport.currentDragComponentInfo.viewportInfo.targetIndex = index
    }

    @action('设置布局元素是否高亮') setLayoutComponentActive(active: boolean) {
        this.viewport.isLayoutComponentActive = active
    }

    @action('修改当前编辑组件的组件属性') updateCurrentEditComponentProps(field: string, value: any) {
        this.updateComponentProps(this.viewport.currentEditComponentMapUniqueKey, field, value)
    }

    @action('修改组件属性') updateComponentProps(mapUniqueKey: string, field: string, value: any) {
        const componentInfo = this.viewport.components.get(mapUniqueKey)
        _.set(componentInfo.props, field, value)
    }

    @action('重置属性') resetProps(mapUniqueKey: string) {
        const componentInfo = this.viewport.components.get(mapUniqueKey)
        const ComponentClass = this.applicationAction.getComponentClassByGaeaUniqueKey(componentInfo.props.gaeaUniqueKey)
        componentInfo.props = extendObservable({}, _.cloneDeep(ComponentClass.defaultProps))
    }

    @action('修改某个组件的属性') setComponentProps(mapUniqueKey: string, path: string, value: any) {
        const componentInfo = this.viewport.components.get(mapUniqueKey)
        _.set(componentInfo.props, path, value)
    }

    /**
     * 补全编辑状态的配置 会修改原对象
     */
    completionEditProps(componentProps: FitGaea.ComponentProps) {
        if (!componentProps.gaeaEventData) {
            componentProps.gaeaEventData = []
        }
        if (!componentProps.gaeaNativeEventData) {
            componentProps.gaeaNativeEventData = []
        }
        if (!componentProps.gaeaVariables) {
            componentProps.gaeaVariables = []
        }
        return componentProps
    }

    /**
     * 注册子元素内部拖动
     * 指的是当前元素与视图元素一一对应，拖拽相当于视图元素的拖拽，可以实现例如 treePlugin
     */
    registerInnerDrag(mapUniqueKey: string, dragParentElement: HTMLElement, groupName = 'gaea-can-drag-in', sortableParam: any = {}) {
        const componentInfo = this.viewport.components.get(mapUniqueKey)

        Sortable.create(dragParentElement, Object.assign({
            animation: 150,
            // 放在一个组里,可以跨组拖拽
            group: {
                name: groupName,
                pull: true,
                put: true
            },
            onStart: (event: any) => {
                this.startDrag({
                    type: 'viewport',
                    dragStartParentElement: dragParentElement,
                    dragStartIndex: event.oldIndex as number,
                    viewportInfo: {
                        mapUniqueKey: componentInfo.layoutChilds[event.oldIndex as number]
                    }
                })
            },
            onEnd: (event: any) => {
                this.endDrag()

                // 在 viewport 中元素拖拽完毕后, 为了防止 outer-move-box 在原来位置留下残影, 先隐藏掉
                this.setCurrentHoverComponentMapUniqueKey(null)
            },
            onAdd: (event: any)=> {
                switch (this.viewport.currentDragComponentInfo.type) {
                    case 'new':
                        // 是新拖进来的, 不用管, 因为工具栏会把它收回去
                        // 为什么不删掉? 因为这个元素不论是不是 clone, 都被移过来了, 不还回去 react 在更新 dom 时会无法找到
                        const newMapUniqueKey = this.addNewComponent(this.viewport.currentDragComponentInfo.newInfo.uniqueKey, mapUniqueKey, event.newIndex as number)

                        // TODO 触发新增事件
                        // this.props.viewport.saveOperate({
                        //     type: 'add',
                        //     mapUniqueKey,
                        //     add: {
                        //         uniqueId: this.props.viewport.currentMovingComponent.uniqueKey,
                        //         parentMapUniqueKey: this.props.mapUniqueKey,
                        //         index: event.newIndex as number
                        //     }
                        // })
                        break

                    case 'viewport':
                        // 这里只还原 dom，和记录拖拽源信息，不会修改 components 数据，跨层级移动在 remove 回调中修改
                        // 是从视图区域另一个元素移过来，而且是新增的,而不是同一个父级改变排序
                        // 把这个元素还给之前拖拽的父级
                        if (this.viewport.currentDragComponentInfo.dragStartParentElement.childNodes.length === 0) {
                            // 之前只有一个元素
                            this.viewport.currentDragComponentInfo.dragStartParentElement.appendChild(event.item)
                        } else if (this.viewport.currentDragComponentInfo.dragStartParentElement.childNodes.length === this.viewport.currentDragComponentInfo.dragStartIndex) {
                            // 是上一次位置是最后一个, 而且父元素有多个元素
                            this.viewport.currentDragComponentInfo.dragStartParentElement.appendChild(event.item)
                        } else {
                            // 不是最后一个, 而且有多个元素
                            // 插入到它下一个元素的前一个
                            this.viewport.currentDragComponentInfo.dragStartParentElement.insertBefore(event.item, this.viewport.currentDragComponentInfo.dragStartParentElement.childNodes[this.viewport.currentDragComponentInfo.dragStartIndex])
                        }

                        // 设置新增时拖拽源信息
                        this.setDragTargetInfo(mapUniqueKey, event.newIndex as number)
                        break

                    case 'combo':
                        // TODO 发布新增组合事件
                        // this.props.viewport.saveOperate({
                        //     type: 'addCombo',
                        //     mapUniqueKey,
                        //     addCombo: {
                        //         parentMapUniqueKey: this.props.mapUniqueKey,
                        //         index: event.newIndex as number,
                        //         componentInfo: component
                        //     }
                        // })
                        break
                }
            },
            onUpdate: (event: any)=> {
                // // 同一个父级下子元素交换父级
                // // 取消 srotable 对 dom 的修改, 让元素回到最初的位置即可复原
                const oldIndex = event.oldIndex as number
                const newIndex = event.newIndex as number
                if (this.viewport.currentDragComponentInfo.dragStartParentElement.childNodes.length === oldIndex + 1) {
                    // 是从最后一个元素开始拖拽的
                    this.viewport.currentDragComponentInfo.dragStartParentElement.appendChild(event.item)
                } else {
                    if (newIndex > oldIndex) {
                        // 如果移到了后面
                        this.viewport.currentDragComponentInfo.dragStartParentElement.insertBefore(event.item, this.viewport.currentDragComponentInfo.dragStartParentElement.childNodes[oldIndex])
                    } else {
                        // 如果移到了前面
                        this.viewport.currentDragComponentInfo.dragStartParentElement.insertBefore(event.item, this.viewport.currentDragComponentInfo.dragStartParentElement.childNodes[oldIndex + 1])
                    }
                }
                this.horizontalMoveComponent(mapUniqueKey, event.oldIndex as number, event.newIndex as number)

                // TODO 保存历史
                // this.props.viewport.saveOperate({
                //     type: 'exchange',
                //     mapUniqueKey: this.props.mapUniqueKey,
                //     exchange: {
                //         oldIndex,
                //         newIndex
                //     }
                // })
            },
            onRemove: (event: any)=> {
                // onEnd 在其之后执行，会清除拖拽目标的信息
                // 减少了一个子元素，一定是发生在 viewport 区域元素发生跨父级拖拽时
                this.moveComponent(mapUniqueKey, this.viewport.currentDragComponentInfo.dragStartIndex, this.viewport.currentDragComponentInfo.viewportInfo.targetMapUniqueKey, this.viewport.currentDragComponentInfo.viewportInfo.targetIndex)

                // 一个元素被跨父级移动，生命周期执行顺序是： 新位置的 didMount -> 原来位置的 willUnmount -> 执行这个方法
                // onEnd 是最后执行，所以不用担心拖拽中间数据被清除
                // 因此在这里修正位置最好
                // 触发一个事件
                this.eventAction.emit(`${this.event.viewportDomUpdate}.${this.viewport.currentDragComponentInfo.viewportInfo.mapUniqueKey}`)

                // 触发 move 事件
                // this.props.viewport.saveOperate({
                //     type: 'move',
                //     // 新增元素父级 key
                //     mapUniqueKey: this.props.mapUniqueKey,
                //     move: {
                //         targetParentMapUniqueKey: this.props.viewport.dragTargetMapUniqueKey,
                //         targetIndex: this.props.viewport.dragTargetIndex,
                //         sourceParentMapUniqueKey: this.props.mapUniqueKey,
                //         sourceIndex: event.oldIndex as number
                //     }
                // })
            }
        }, sortableParam))
    }

    /**
     * 子元素外部拖动
     * 拖动的元素会拷贝一份在视图中，自身不会减少，可以做拖拽菜单
     * 如果子元素有 data-unique-key 属性，则会创建一个新元素
     * 如果子元素有 data-source 属性，则会创建一个组合
     */
    registerOuterDarg(dragParentElement: HTMLElement, groupName = 'gaea-can-drag-in') {
        // 上次拖拽的位置
        let lastDragStartIndex = -1

        Sortable.create(dragParentElement, {
            animation: 150,
            // 放在一个组里,可以跨组拖拽
            group: {
                name: groupName,
                pull: 'clone',
                put: false
            },
            sort: false,
            delay: 0,
            onStart: (event: any) => {
                lastDragStartIndex = event.oldIndex as number
                this.startDrag({
                    type: 'new',
                    dragStartParentElement: dragParentElement,
                    dragStartIndex: event.oldIndex as number,
                    newInfo: {
                        uniqueKey: event.item.dataset.uniqueKey
                    }
                })
            },
            onEnd: (event: any) => {
                this.endDrag()
                // 因为是 clone 方式, 拖拽成功的话元素会重复, 没成功拖拽会被添加到末尾
                // 所以先移除 clone 的元素（吐槽下, 拖走的才是真的, 留下的才是 clone 的）
                // 有 parentNode, 说明拖拽完毕还是没有被清除, 说明被拖走了, 因为如果没真正拖动成功, clone 元素会被删除
                if (event.clone.parentNode) {
                    // 有 clone, 说明已经真正拖走了
                    dragParentElement.removeChild(event.clone)
                    // 再把真正移过去的弄回来
                    if (lastDragStartIndex === dragParentElement.childNodes.length) {
                        // 如果拖拽的是最后一个
                        dragParentElement.appendChild(event.item)
                    } else {
                        // 拖拽的不是最后一个
                        dragParentElement.insertBefore(event.item, dragParentElement.childNodes[lastDragStartIndex])
                    }
                } else {
                    // 没拖走, 只是晃了一下, 不用管了
                }
            }
        })
    }

    /**
     * 获取某个组件全部子元素 mapUniqueKey 数组
     */
    getAllChildsByMapUniqueKey(mapUniqueKey: string) {
        const componentInfo = this.viewport.components.get(mapUniqueKey)
        let childMapUniqueKeys = componentInfo.layoutChilds || []
        // 找到其子组件
        componentInfo.layoutChilds && componentInfo.layoutChilds.forEach(childMapUniqueKey=> {
            childMapUniqueKeys = childMapUniqueKeys.concat(this.getAllChildsByMapUniqueKey(childMapUniqueKey))
        })
        return childMapUniqueKeys
    }

    /**
     * 获取当前编辑组件的属性值
     */
    getCurrentEditPropValueByEditInfo(editInfo: FitGaea.ComponentPropsGaeaEdit) {
        const value = _.get(this.viewport.currentEditComponentInfo.props, editInfo.field)

        if (value === null || value === undefined || value === editInfo.emptyValue) {
            return ''
        }
        return value.toString()
    }
}
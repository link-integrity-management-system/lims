import argparse
import hashlib
import pdb
import secrets
import sys
import traceback

import esprima

LEN_FN_NONCE = 16


def annotate_fn_param_nonces(node, fn_data=dict(), curr_fn=None):
    """Annotate Identifier nodes that represent function parameters with a
    nonce that is unique to the function.

    Args:
        node (esprima.nodes.Node): AST node
        fn_data (dict, optional): associates FunctionDeclaration nodes to parameter names and unique nonce. Defaults to dict().
        curr_fn (esprima.nodes.FunctionDeclaration, optional): the current function. Defaults to None.
    """
    if type(node) == esprima.nodes.FunctionDeclaration:
        curr_fn = node
        if curr_fn not in fn_data:
            param_names = [param.name for param in node.params]
            nonce = secrets.token_hex(LEN_FN_NONCE)
            fn_data[node] = dict(param_names=param_names, nonce=nonce)
    children = get_children(node)
    if len(children) == 0 and not is_non_identifier(node) and curr_fn is not None:
        param_names = fn_data[curr_fn]["param_names"]
        nonce = fn_data[curr_fn]["nonce"]
        if node.name in param_names:
            node.nonce = nonce
    for child in children:
        annotate_fn_param_nonces(child, fn_data, curr_fn=curr_fn)


def inject_nodes(node, struct_nodes):
    """Injects several types of nodes to the esprima-parsed AST to make it
    more similar to the AST grammar presented in the Sicilian Defense paper.

    Args:
        node (esprima.nodes.Node): AST node
        struct_nodes (dict): associates (the hashes of) AST nodes to their Structure nodes
    """
    inject_operator_nodes(node)
    inject_structure_nodes(node, struct_nodes)
    inject_left_right_nodes(node)
    children = get_children(node)
    for child in children:
        inject_nodes(child, struct_nodes)


# def annotate_fn_param_nonce(node, param_names, nonce):
#     children = get_children(node)
#     if len(children) == 0 and not is_non_identifier(node):
#         if node.name in param_names:
#             node.nonce = nonce
#     for child in children:
#         annotate_fn_param_nonce(child, param_names, nonce)


class Syntax:
    AssignmentOperator = "AssignmentOperator"
    UnaryOperator = "UnaryOperator"
    BinaryOperator = "BinaryOperator"
    UpdateOperator = "UpdateOperator"
    Undefined = "Undefined"
    FunctionParameterDeclarator = "FunctionParameterDeclarator"
    FunctionStructure = "FunctionStructure"
    VariableStructure = "VariableStructure"
    LHSExpression = "LHSExpression"
    RHSExpression = "RHSExpression"


class Operator(esprima.nodes.Node):
    def __init__(self, operator, _type):
        self.operator = operator
        self._type = _type


class AssignmentOperator(Operator):

    _TYPE = Syntax.AssignmentOperator

    def __init__(self, operator):
        super().__init__(operator, AssignmentOperator._TYPE)


class UnaryOperator(Operator):

    _TYPE = Syntax.UnaryOperator

    def __init__(self, operator):
        super().__init__(operator, UnaryOperator._TYPE)


class BinaryOperator(Operator):

    _TYPE = Syntax.BinaryOperator

    def __init__(self, operator):
        super().__init__(operator, BinaryOperator._TYPE)


class UpdateOperator(Operator):

    _TYPE = Syntax.UpdateOperator

    def __init__(self, operator):
        super().__init__(operator, UpdateOperator._TYPE)


class Undefined(esprima.nodes.Node):

    _TYPE = Syntax.Undefined

    def __init__(self):
        self.type = Undefined._TYPE


class FunctionParameterDeclarator(esprima.nodes.Node):

    _TYPE = Syntax.FunctionParameterDeclarator

    def __init__(self, identifier_node):
        self.type = FunctionParameterDeclarator._TYPE
        self.id = identifier_node


class Structure(esprima.nodes.Node):
    def __init__(self, _type):
        self.type = _type


class FunctionStructure(Structure):

    _TYPE = Syntax.FunctionStructure

    def __init__(self, node):
        super().__init__(FunctionStructure._TYPE)
        self.nonce = secrets.token_hex(LEN_FN_NONCE)
        self.body = node.body
        self.params = []
        if node.params is None:
            pdb.set_trace()
        for param in node.params:
            param_node = FunctionParameterDeclarator(param)
            self.params.append(param_node)

        # param_names = [param.name for param in self.params]
        # for identifier in self.params:
        #     if (
        #         "a_structure" in identifier.keys()
        #         and type(identifier.a_structure) == VariableStructure
        #     ):
        #         return
        #     identifier_struct_node = VariableStructure(
        #         identifier, struct_nodes, nonce=self.nonce
        #     )
        #     hash_identifier = _get_hash_of_node(identifier)
        #     struct_nodes[hash_identifier] = (identifier, identifier_struct_node)
        #     pdb.set_trace()
        #     identifier.a_structure = identifier_struct_node


class VariableStructure(Structure):

    _TYPE = Syntax.VariableStructure

    def __init__(self, node):
        super().__init__(VariableStructure._TYPE)
        init_node = Undefined()
        try:
            init_node = node.init if node.init is not None else init_node
        except AttributeError:
            pass
        self.init = init_node


class LHSExpression(esprima.nodes.Node):

    _TYPE = Syntax.LHSExpression

    def __init__(self, left):
        self.type = LHSExpression._TYPE
        self.left = left


class RHSExpression(esprima.nodes.Node):

    _TYPE = Syntax.RHSExpression

    def __init__(self, right):
        self.type = RHSExpression._TYPE
        self.right = right


EXPRESSION_TO_OPERATOR_NODE = {
    esprima.nodes.AssignmentExpression: AssignmentOperator,
    esprima.nodes.UnaryExpression: UnaryOperator,
    esprima.nodes.BinaryExpression: BinaryOperator,
    esprima.nodes.UpdateExpression: UpdateOperator,
}

EXPECTED_STRUCTURE_NODES = {
    esprima.nodes.VariableDeclarator: VariableStructure,
    esprima.nodes.FunctionDeclaration: FunctionStructure,
    FunctionParameterDeclarator: VariableStructure,
}

UNORDERED_NODE_TYPES = set([esprima.nodes.ObjectExpression])


def inject_operator_nodes(node):
    if issubclass(type(node), Operator):
        return
    if "operator" not in node.keys():
        return
    if issubclass(type(node.operator), Operator):
        return
    op_node_cls = EXPRESSION_TO_OPERATOR_NODE[type(node)]
    node.operator = op_node_cls(node.operator)


def inject_structure_nodes(node, struct_nodes):
    # injects at `a_structure` as an implementation detail
    #    so that the structure node is encountered in the postorder
    #    traversal before the identifier node is encountered
    _type = type(node)
    struct_node_cls = EXPECTED_STRUCTURE_NODES.get(_type, None)
    if struct_node_cls is None:
        return
    if "a_structure" in node.keys():
        return
    struct_node = struct_node_cls(node)
    if node.id is None:
        pdb.set_trace()
    hash_node = _get_hash_of_node(node.id)
    struct_nodes[hash_node] = (node, struct_node)
    node.a_structure = struct_node
    try:
        if _type == esprima.nodes.VariableDeclarator:
            del node.init  # now part of the struct node
        if _type == esprima.nodes.FunctionDeclaration:
            del node.params
            del node.body
    except AttributeError:
        pass
    # pdb.set_trace()


def inject_left_right_nodes(node):
    if type(node) == LHSExpression or type(node) == RHSExpression:
        return
    has_left = "left" in node.keys()
    has_right = "right" in node.keys()
    if has_left and type(node.left) != LHSExpression:
        node.left = LHSExpression(node.left)
    if has_right and type(node.right) != RHSExpression:
        node.right = RHSExpression(node.right)


def is_node(n):
    return issubclass(type(n), esprima.nodes.Node)


def _get_label_literal(n):
    return n.value


def _get_label_identifier(n):
    return n.name


def _get_label_operator(node):
    return node.operator


# def _get_hash_of_leaf_node(node):
#     flattened = []
#     for k, v in node.items():
#         flattened.append(k)
#         if type(v) == list:
#             for e in v:
#                 hash_e = hash(e)
#                 if issubclass(type(e), esprima.nodes.Node):
#                     hash_e = _get_hash_of_leaf_node(e)
#                 flattened.append(hash_e)
#         else:
#             flattened.append(v)
#     try:
#         return hash(tuple(flattened))
#     except Exception as exc:
#         pdb.set_trace()
#         raise exc


def _get_hash_of_node(node):
    """Returns a hash of an AST node.
    This is primarily used to create a unique identifier
    for multiple AST nodes that refer to the same identifier,
    and is used to refine its structural identity.

    Args:
        node (esprima.nodes.Node): leaf AST node

    Raises:
        RuntimeError: if the node passed is not a leaf

    Returns:
        int: hash of the node
    """
    flattened = []
    for k, v in node.items():
        flattened.append(k)
        if type(v) == list:
            for e in v:
                hash_e = hash(e)
                if issubclass(type(e), esprima.nodes.Node):
                    hash_e = _get_hash_of_node(e)
                flattened.append(hash_e)
        else:
            if issubclass(type(v), esprima.nodes.Node):
                flattened.append(_get_hash_of_node(v))
            else:
                flattened.append(v)
    return hash(tuple(flattened))


def get_structure_node(n, struct_nodes):
    """Returns the Structure node of a
    FunctionDeclaration node or a VariableDeclaration node.

    Args:
        n (esprima.nodes.Node): AST node
        struct_nodes (dict): map of the (hash of the) nodes to their Structure node

    Returns:
        Structure: the associated Structure node, or None
    """
    if n.a_structure is not None:
        return n.a_structure
    try:
        hash_node = _get_hash_of_node(n)
        return struct_nodes[hash_node][1]
    except KeyError:
        pass
    return None


NODE_LABEL_FN = {
    esprima.nodes.Literal: _get_label_literal,
    esprima.nodes.Identifier: _get_label_identifier,
    Operator: _get_label_operator,
}


def get_label(node):
    for _type, _fn in NODE_LABEL_FN.items():
        if type(node) is _type or issubclass(type(node), _type):
            return _fn(node)
    return f"{node.type}Type"


def get_type(n):
    return n.type


def get_children(n):
    children = []
    for _key1, _val1 in sorted(n.items()):
        # property is a node
        if is_node(_val1):
            children.append(_val1)
            continue
        try:
            for x in _val1:
                # property is an iterable of nodes
                if is_node(x):
                    children.append(x)
                    continue
        except Exception:
            pass
    return children


def is_leaf(n):
    return len(get_children(n)) == 0


def is_non_identifier(n):
    return type(n) != esprima.nodes.Identifier


def sig_hash(_str):
    try:
        m = hashlib.sha256()
        m.update(_str.encode("utf-8", "ignore"))
        return m.hexdigest()
    except Exception as exc:
        pdb.set_trace()
        traceback.print_exc()


def concat_strings(*args):
    output = ""
    for arg in args:
        output += f"{arg}"
    return output


def is_unordered(n):
    return type(n) in UNORDERED_NODE_TYPES


def is_top_level(n, prog):
    return n in get_children(prog)


def refine_structids(struct_id, identity_pos, s):
    for _key in identity_pos.keys():
        # _node = identity_pos[_key][0]
        # init_struct_id = struct_id[_key][1]
        pos_hash = ""
        for p in identity_pos[_key][1]:
            pos_hash = concat_strings(pos_hash, sig_hash(p))
        t = concat_strings(s, pos_hash)
        struct_id[_key][1] = sig_hash(concat_strings(struct_id[_key][1], t))
        # print(
        #     f"refined _key={_key} _node={_node.__dict__} id={init_struct_id} -> {struct_id[_key][1]}"
        # )


def _structural_signature_recurs(node, pos, prog, struct_id, struct_nodes, identity_pos):
    # if node is None:
    #     pdb.set_trace()
    # inject_operator_nodes(node)
    # inject_structure_nodes(node, struct_nodes)
    # inject_left_right_nodes(node)
    label = get_label(node)
    _type = get_type(node)
    children = get_children(node)
    # if node == prog:
    #     pdb.set_trace()
    if len(children) == 0:
        hash_node = _get_hash_of_node(node)
        if is_non_identifier(node):
            s = sig_hash(concat_strings(_type, label))
        # identifier leaf, refer to Section 3.5.3 of Sicilian
        elif hash_node in struct_id:
            s = struct_id[hash_node][1]
            if hash_node not in identity_pos:
                identity_pos[hash_node] = [node, []]
            identity_pos[hash_node][1].append(concat_strings(pos, "Identifier"))
        else:
            # try:
            #     n_struct = get_structure_node(node, struct_nodes)
            # except KeyError:
            #     list_keys = list(struct_nodes.keys())
            #     pdb.set_trace()

            n_struct = get_structure_node(node, struct_nodes)
            # pdb.set_trace()
            if n_struct is not None:
                s = sig_hash(
                    concat_strings(
                        sig_hash(_type),
                        _structural_signature_recurs(
                            n_struct, pos, prog, struct_id, struct_nodes, identity_pos
                        ),
                    )
                )
            else:
                # unable to compute structural identity,
                # fallback to default signature computation
                # as specified in beginning of Section 3.5.3
                s = sig_hash(sig_hash(label))
            struct_id[hash_node] = [node, s]
    else:
        signature = []
        for child in children:
            signature.append(
                _structural_signature_recurs(
                    child,
                    concat_strings(pos, _type),
                    prog,
                    struct_id,
                    struct_nodes,
                    identity_pos,
                )
            )
        signature = sorted(signature) if is_unordered(node) else signature
        s = sig_hash(concat_strings(sig_hash(label), *signature))
        if is_top_level(node, prog):
            refine_structids(struct_id, identity_pos, s)
            identity_pos = {}  # flush identity_pos
    # print(node.__dict__, s)
    return s


def structural_signature_recurs(node, pos, prog):
    struct_id = {}
    struct_nodes = {}
    identity_pos = {}
    annotate_fn_param_nonces(node)
    inject_nodes(node, struct_nodes)
    return _structural_signature_recurs(node, pos, prog, struct_id, struct_nodes, identity_pos)


def _traverse(_node, struct_nodes):
    stack = [_node]
    order = []
    node_pos = {}
    while len(stack) > 0:
        node = stack.pop()
        # inject_operator_nodes(node)
        # inject_structure_nodes(node, struct_nodes)
        # inject_left_right_nodes(node)
        order.append(node)

        _type = get_type(node)
        children = get_children(node)
        pos = None
        if node not in node_pos:
            node_pos[node] = ""
        pos = node_pos[node]
        for child in children:
            child_pos = concat_strings(pos, _type)
            node_pos[child] = child_pos
            stack.append(child)
        if len(children) == 0 and not is_non_identifier(node):
            node_pos[node] = concat_strings(pos, "Identifier")
    traversal = list(reversed(order))
    return traversal, node_pos


def traverse(ast):
    struct_nodes = {}
    nodes, node_pos = _traverse(ast, struct_nodes)
    return nodes, node_pos


def _structural_signature_of_later_struct_node(node, signatures):
    label = get_label(node)
    children = get_children(node)
    hash_node = _get_hash_of_node(node)
    signature = []
    for child in children:
        _type_child = get_type(child)
        label_child = get_label(child)
        hash_child = _get_hash_of_node(child)
        signature_child = sig_hash(concat_strings(_type_child, label_child))
        signature.append(signature_child)
        signatures[hash_child] = signature_child
    signature = sorted(signature) if is_unordered(node) else signature
    s = sig_hash(concat_strings(sig_hash(label), *signature))
    signatures[hash_node] = s


def _structural_signature_iter(nodes, node_pos, identity_pos, struct_id, struct_nodes):
    signatures = {}
    prog = nodes[-1]
    hash_prog = _get_hash_of_node(prog)
    for node in nodes:
        label = get_label(node)
        _type = get_type(node)
        children = get_children(node)
        pos = node_pos[node]
        hash_node = _get_hash_of_node(node)
        if hash_node in signatures:
            continue

        if len(children) == 0:
            if is_non_identifier(node):
                s = sig_hash(concat_strings(_type, label))
            # identifier leaf, refer to Section 3.5.3 of Sicilian
            elif hash_node in struct_id:
                s = struct_id[hash_node][1]
                if hash_node not in identity_pos:
                    identity_pos[hash_node] = [node, []]
                identity_pos[hash_node][1].append(concat_strings(pos, "Identifier"))
            else:
                n_struct = get_structure_node(node, struct_nodes)
                if n_struct is not None:
                    hash_struct_node = _get_hash_of_node(n_struct)
                    if hash_struct_node not in signatures:
                        _structural_signature_of_later_struct_node(n_struct, signatures)
                    s = sig_hash(concat_strings(sig_hash(_type), signatures[hash_struct_node]))
                else:
                    # unable to compute structural identity,
                    # fallback to default signature computation
                    # as specified in beginning of Section 3.5.3
                    s = sig_hash(sig_hash(label))
                struct_id[hash_node] = [node, s]
        else:
            signature = []
            for child in children:
                hash_child = _get_hash_of_node(child)
                signature.append(signatures[hash_child])
            signature = sorted(signature) if is_unordered(node) else signature
            s = sig_hash(concat_strings(sig_hash(label), *signature))
            if is_top_level(node, prog):
                refine_structids(struct_id, identity_pos, s)
        signatures[hash_node] = s
        # print(node.__dict__, s)
    return signatures[hash_prog], signatures


def structural_signature_iter(ast):
    struct_id = {}
    struct_nodes = {}
    identity_pos = {}
    annotate_fn_param_nonces(ast)
    inject_nodes(ast, struct_nodes)
    nodes, node_pos = _traverse(ast, struct_nodes)
    script_sig, all_sigs = _structural_signature_iter(
        nodes, node_pos, identity_pos, struct_id, struct_nodes
    )
    # return script_sig, all_sigs, nodes, node_pos, identity_pos
    return script_sig


def _test():
    TEST_SCRIPTS = {
        # variable renaming
        1: ["var x = 10, y; y = x+1;", "var a = 10, b; b = a+1;"],
        # permutations
        2: [
            "var x = {a: 'hi', b: 'bye'};",
            "var x = {b: 'bye', a: 'hi'};",
        ],
        # function var renaming
        3: [
            """\
            function abc(a,b,c) {
                console.log(a);
                console.log(b+c);
            }
            """,
            """\
            function abc(x,y,z) {
                console.log(x);
                console.log(y+z);
            }
            """,
        ],
    }
    print(f"TEST SCRIPTS...")
    print(TEST_SCRIPTS)
    for num, scripts in TEST_SCRIPTS.items():
        ast0 = esprima.parseScript(scripts[0])
        sig0 = structural_signature_iter(ast0)

        ast1 = esprima.parseScript(scripts[1])
        sig1 = structural_signature_iter(ast1)

        print(f"CHECKING SIGNATURES FOR SCRIPT {num}")

        out = f"  ITERATIVE..."
        if sig0 == sig1:
            out += f"matched"
        else:
            out += f"MISMATCHED"
        out += "\n  RECURSIVE..."

        ast0 = esprima.parseScript(scripts[0])
        sig0_recurs = structural_signature_recurs(ast0, "", ast0)

        ast1 = esprima.parseScript(scripts[1])
        sig1_recurs = structural_signature_recurs(ast1, "", ast1)

        if sig0_recurs == sig1_recurs:
            out += f"matched"
        else:
            out += f"MISMATCHED"
        out += "\n  ITERATIVE <-> RECURSIVE..."

        if sig0_recurs == sig0:
            out += f"matched"
        else:
            out += f"MISMATCHED"
        out += "\n"
        print(out)


def main():
    script = sys.stdin.read()
    ast = esprima.parseScript(script)
    sig = structural_signature_iter(ast)
    print(sig)

if __name__ == "__main__":
    main()